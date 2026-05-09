import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Alert } from "./types";
import { mockAlerts } from "./mock-alerts";
import { seedAlertsBaseSepolia, seedAlertsBaseSepoliaUpdatedAt } from "./seed-alerts";

const SWARM_FEED_URL = process.env.SWARM_FEED_URL;
const SWARM_FETCH_TIMEOUT_MS = 5_000;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../..");
const ALERTS_FILE = path.join(REPO_ROOT, "data", "alerts.json");
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

async function fetchLatestFromSwarm(url: string): Promise<Alert | null> {
  console.log(`[loadAlerts] Swarm fetch → ${url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SWARM_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    console.log(
      `[loadAlerts] Swarm response status=${res.status} content-type=${res.headers.get("content-type") ?? "n/a"} feed-index=${res.headers.get("swarm-feed-index") ?? "n/a"}`,
    );
    if (!res.ok) {
      console.warn(`[loadAlerts] Swarm non-200 (${res.status}) — skipping`);
      return null;
    }
    const data = await res.json();
    if (!isAlert(data)) {
      console.warn(`[loadAlerts] Swarm payload failed isAlert validation`, data);
      return null;
    }
    console.log(
      `[loadAlerts] Swarm OK — id=${data.id} severity=${data.severity} proxy=${data.proxyAddress} tx=${data.txHash}`,
    );
    return data;
  } catch (err) {
    console.warn("[loadAlerts] Swarm fetch failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    console.log(
      `[loadAlerts] file ${path.basename(filePath)} → ${normalized.length} alert(s)`,
    );
    return { alerts: normalized, updatedAt: parsed.updatedAt };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[loadAlerts] failed to read ${filePath}:`, err);
    }
    return null;
  }
}

export async function loadAlerts(): Promise<LoadAlertsResult> {
  console.log(
    `[loadAlerts] start — SWARM_FEED_URL=${SWARM_FEED_URL ? "set" : "unset"}`,
  );

  const [swarmLatest, main, sepoliaFile] = await Promise.all([
    SWARM_FEED_URL ? fetchLatestFromSwarm(SWARM_FEED_URL) : Promise.resolve(null),
    readAlertsFile(ALERTS_FILE, BASE_CHAIN_ID),
    readAlertsFile(ALERTS_SEPOLIA_FILE, BASE_SEPOLIA_CHAIN_ID),
  ]);

  const sepolia =
    sepoliaFile ?? {
      alerts: seedAlertsBaseSepolia,
      updatedAt: seedAlertsBaseSepoliaUpdatedAt,
    };

  const merged: Alert[] = [];
  if (swarmLatest) merged.push(swarmLatest);
  if (main) merged.push(...main.alerts);
  if (sepolia) merged.push(...sepolia.alerts);

  const seen = new Set<string>();
  const deduped = merged.filter((a) => {
    if (seen.has(a.txHash)) return false;
    seen.add(a.txHash);
    return true;
  });

  console.log(
    `[loadAlerts] composition — swarm=${swarmLatest ? 1 : 0} mainFile=${main?.alerts.length ?? 0} sepoliaFile=${sepoliaFile?.alerts.length ?? 0} seedFallback=${sepoliaFile ? 0 : seedAlertsBaseSepolia.length} → deduped=${deduped.length}`,
  );

  if (deduped.length === 0) {
    console.log(`[loadAlerts] no alerts found — returning mock`);
    return { alerts: mockAlerts, source: "mock" };
  }

  deduped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const latestUpdated = [
    swarmLatest ? new Date().toISOString() : undefined,
    main?.updatedAt,
    sepolia?.updatedAt,
  ]
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  console.log(
    `[loadAlerts] returning ${deduped.length} alert(s) source=live updatedAt=${latestUpdated ?? "n/a"}`,
  );
  return { alerts: deduped, source: "live", updatedAt: latestUpdated };
}
