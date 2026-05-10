import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bee, MantarayNode, Topic } from "@ethersphere/bee-js";
import type { Alert } from "./types";
import { mockAlerts } from "./mock-alerts";
import { seedAlertsBaseSepolia, seedAlertsBaseSepoliaUpdatedAt } from "./seed-alerts";
import { makeLogger } from "./log";

const log = makeLogger("loadAlerts");

const SWARM_FEED_URL = process.env.SWARM_FEED_URL;
const SWARM_GATEWAY = "https://bzz.limo";
// Same topic the Worker uses in src/swarm/index.ts. Keep these in sync.
const VIGIL_MANIFEST_TOPIC = Topic.fromString("vigil-manifest");
// Cap how many historical blocks we pull from Swarm per cold cache miss.
// loadRecursively walks the full manifest tree (~14s for ~400 entries on bzz.limo),
// then we download the top-N payloads. 50 is enough to populate the dashboard
// without making cold renders punishingly slow.
const SWARM_MAX_BLOCKS = 50;
const SWARM_FETCH_CONCURRENCY = 10;
// 5-minute in-process cache so the cold-fetch happens once per demo run, not
// once per page render. Subsequent renders within the window are near-instant.
const SWARM_CACHE_TTL_MS = 5 * 60 * 1000;
let swarmCache: { alerts: Alert[]; cachedAt: number } | null = null;
// In-flight dedup: when N concurrent requests arrive on a cold cache, share
// one fetch instead of starting N parallel Mantaray walks against bzz.limo.
let swarmInFlight: Promise<Alert[]> | null = null;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../..");
// Three sources merge into the dashboard:
//   - alerts.json: Kristian's external pipeline output (chainId defaults to 8453)
//   - alerts-base-mainnet.json: our watcher's output for Base mainnet upgrades
//   - alerts-base-sepolia.json: legacy/testing output for Base Sepolia
const ALERTS_FILE = path.join(REPO_ROOT, "data", "alerts.json");
const ALERTS_MAINNET_FILE = path.join(REPO_ROOT, "data", "alerts-base-mainnet.json");
const ALERTS_SEPOLIA_FILE = path.join(REPO_ROOT, "data", "alerts-base-sepolia.json");

const BASE_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;

export type LoadAlertsResult = {
  alerts: Alert[];
  source: "live" | "mock";
  updatedAt?: string;
};

function isAlert(value: unknown): value is Alert {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.txHash === "string" &&
    typeof v.severity === "string"
  );
}

// Pulls the full alert history from Swarm by walking the Mantaray manifest the
// Worker writes to via `ChainArchive.archiveBlock(blockNumber, { alert, block })`.
// Each leaf at `blocks/<n>` is content-addressed JSON; we collect leaves, fetch
// in parallel batches, and return Alert[] sorted newest first.
function extractOwnerFromFeedUrl(url: string): string | null {
  const match = url.match(/\/feeds\/(0x[0-9a-fA-F]{40})/);
  return match?.[1] ?? null;
}

// Hard cap on the SSR Swarm walk so the home page always renders within
// Railway's ~30s edge timeout. If bzz.limo is slow or unreachable, fall back
// to whatever else is available (cache, file, mock) instead of hanging.
const SWARM_FETCH_TIMEOUT_MS = 8_000;

// On timeout, store an empty result with a short effective TTL so the next
// requests within the window respond instantly instead of waiting another
// 8s. The background doFetchAlertsFromSwarm keeps running and will overwrite
// the cache with real data if it eventually succeeds.
const SWARM_FAILED_FETCH_TTL_MS = 60_000;

async function fetchAlertsFromSwarm(feedUrl: string): Promise<Alert[]> {
  if (swarmCache && Date.now() - swarmCache.cachedAt < SWARM_CACHE_TTL_MS) {
    log.info(`Swarm cache hit, ${swarmCache.alerts.length} alert(s)`);
    return swarmCache.alerts;
  }
  if (swarmInFlight) {
    log.info(`Swarm read already in flight, joining`);
    return swarmInFlight;
  }
  const timeoutPromise = new Promise<Alert[]>((resolve) =>
    setTimeout(() => {
      log.warn(`Swarm fetch timed out after ${SWARM_FETCH_TIMEOUT_MS}ms, caching [] for ${SWARM_FAILED_FETCH_TTL_MS}ms`);
      // Backdate cachedAt so SWARM_CACHE_TTL_MS effectively expires in
      // SWARM_FAILED_FETCH_TTL_MS instead of the full TTL window.
      swarmCache = {
        alerts: [],
        cachedAt: Date.now() - (SWARM_CACHE_TTL_MS - SWARM_FAILED_FETCH_TTL_MS),
      };
      resolve([]);
    }, SWARM_FETCH_TIMEOUT_MS),
  );
  swarmInFlight = Promise.race([
    doFetchAlertsFromSwarm(feedUrl),
    timeoutPromise,
  ]).finally(() => {
    swarmInFlight = null;
  });
  return swarmInFlight;
}

// Pre-warm the cache at server boot (called from instrumentation.ts). The
// first user request after boot then hits the warm cache instead of triggering
// a 30s cold Mantaray walk that Railway's edge proxy times out at ~30s.
export async function warmSwarmCache(): Promise<void> {
  if (!SWARM_FEED_URL) return;
  log.start("Pre-warming Swarm cache at boot");
  try {
    await fetchAlertsFromSwarm(SWARM_FEED_URL);
    log.ok("Swarm cache pre-warmed");
  } catch (err) {
    log.warn("Pre-warm failed (non-fatal)", err);
  }
}

async function doFetchAlertsFromSwarm(feedUrl: string): Promise<Alert[]> {
  const owner = extractOwnerFromFeedUrl(feedUrl);
  if (!owner) {
    log.warn(`Cannot extract owner address from feed URL: ${feedUrl}`);
    return [];
  }

  log.step(`Swarm read → owner=${owner}`);
  const bee = new Bee(SWARM_GATEWAY);
  const feedReader = bee.makeFeedReader(VIGIL_MANIFEST_TOPIC, owner);

  let manifestRef;
  try {
    const result = await feedReader.downloadReference();
    manifestRef = result.reference;
    log.info(`Feed reference: ${manifestRef.toHex().slice(0, 16)}...`);
  } catch (err) {
    log.warn("Feed read failed", err);
    return [];
  }

  let node: MantarayNode;
  try {
    node = await MantarayNode.unmarshal(bee, manifestRef);
    await node.loadRecursively(bee);
  } catch (err) {
    log.warn("Manifest load failed", err);
    return [];
  }

  const blockEntries: { blockNumber: number; targetAddress: Uint8Array }[] = [];
  for (const entry of node.collect()) {
    const m = /^blocks\/(\d+)$/.exec(entry.fullPathString);
    if (m && m[1]) {
      blockEntries.push({
        blockNumber: parseInt(m[1], 10),
        targetAddress: entry.targetAddress,
      });
    }
  }

  blockEntries.sort((a, b) => b.blockNumber - a.blockNumber);
  const limited = blockEntries.slice(0, SWARM_MAX_BLOCKS);
  log.info(
    `Manifest has ${blockEntries.length} block(s); fetching most recent ${limited.length}`,
  );

  const alerts: Alert[] = [];
  for (let i = 0; i < limited.length; i += SWARM_FETCH_CONCURRENCY) {
    const batch = limited.slice(i, i + SWARM_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (entry) => {
        try {
          const data = await bee.downloadData(entry.targetAddress);
          const parsed = JSON.parse(data.toUtf8()) as { alert?: unknown };
          if (parsed.alert && isAlert(parsed.alert)) return parsed.alert;
          return null;
        } catch {
          return null;
        }
      }),
    );
    for (const a of results) {
      if (a) alerts.push(a);
    }
  }

  log.ok(`Swarm read complete, ${alerts.length} alert(s) recovered`);
  swarmCache = { alerts, cachedAt: Date.now() };
  return alerts;
}

async function readAlertsFile(filePath: string, defaultChainId: number): Promise<{
  alerts: Alert[];
  updatedAt?: string;
} | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { alerts?: Alert[]; updatedAt?: string };
    if (!parsed.alerts || parsed.alerts.length === 0) return null;
    const normalized = parsed.alerts.map((a) => ({
      ...a,
      chainId: typeof a.chainId === "number" ? a.chainId : defaultChainId,
    }));
    log.info(
      `file ${path.basename(filePath)} → ${normalized.length} alert(s)`,
    );
    return { alerts: normalized, updatedAt: parsed.updatedAt };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.error(`failed to read ${filePath}`, err);
    }
    return null;
  }
}

export async function loadAlerts(): Promise<LoadAlertsResult> {
  log.start(
    `start, SWARM_FEED_URL=${SWARM_FEED_URL ? "set" : "unset"}`,
  );

  const [swarmAlerts, main, mainnetFile, sepoliaFile] = await Promise.all([
    SWARM_FEED_URL ? fetchAlertsFromSwarm(SWARM_FEED_URL) : Promise.resolve<Alert[]>([]),
    readAlertsFile(ALERTS_FILE, BASE_CHAIN_ID),
    readAlertsFile(ALERTS_MAINNET_FILE, BASE_CHAIN_ID),
    readAlertsFile(ALERTS_SEPOLIA_FILE, BASE_SEPOLIA_CHAIN_ID),
  ]);

  const sepolia =
    sepoliaFile ?? {
      alerts: seedAlertsBaseSepolia,
      updatedAt: seedAlertsBaseSepoliaUpdatedAt,
    };

  const merged: Alert[] = [];
  // Swarm first so its values win the dedup pass, Swarm is the authoritative
  // decentralized source; local JSON files are just per-instance caches.
  merged.push(...swarmAlerts);
  if (main) merged.push(...main.alerts);
  if (mainnetFile) merged.push(...mainnetFile.alerts);
  if (sepolia) merged.push(...sepolia.alerts);

  const seen = new Set<string>();
  const deduped = merged.filter((a) => {
    if (seen.has(a.txHash)) return false;
    seen.add(a.txHash);
    return true;
  });

  log.info(
    `composition, swarm=${swarmAlerts.length} mainFile=${main?.alerts.length ?? 0} mainnetFile=${mainnetFile?.alerts.length ?? 0} sepoliaFile=${sepoliaFile?.alerts.length ?? 0} seedFallback=${sepoliaFile ? 0 : seedAlertsBaseSepolia.length} → deduped=${deduped.length}`,
  );

  if (deduped.length === 0) {
    log.warn("no alerts found, returning mock");
    return { alerts: mockAlerts, source: "mock" };
  }

  deduped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const latestUpdated = [
    swarmAlerts[0]?.timestamp,
    main?.updatedAt,
    mainnetFile?.updatedAt,
    sepolia?.updatedAt,
  ]
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  log.ok(
    `returning ${deduped.length} alert(s) source=live updatedAt=${latestUpdated ?? "n/a"}`,
  );
  return { alerts: deduped, source: "live", updatedAt: latestUpdated };
}
