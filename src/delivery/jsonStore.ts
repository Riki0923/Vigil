import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Alert } from "../alerts/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../..");
const DATA_DIR = path.join(REPO_ROOT, "data");

// Per-chain file mapping. The frontend's load-alerts.ts mirrors this and
// default-fills missing chainId per file, so an alert that lands in
// alerts-base-sepolia.json is treated as Base Sepolia even if its chainId
// field is unset (legacy alerts from before this routing existed).
const FILE_BY_CHAIN: Record<number, string> = {
  8453: "alerts.json",
  84532: "alerts-base-sepolia.json",
};

const FALLBACK_FILENAME = "alerts.json";

function pathForChain(chainId: number | undefined): string {
  const filename = chainId !== undefined ? FILE_BY_CHAIN[chainId] : undefined;
  if (chainId !== undefined && !filename) {
    console.warn(
      `[jsonStore] no per-chain file mapping for chainId=${chainId} — falling back to ${FALLBACK_FILENAME}`,
    );
  }
  return path.join(DATA_DIR, filename ?? FALLBACK_FILENAME);
}

type StoreShape = {
  updatedAt: string;
  alerts: Alert[];
};

async function readStore(filePath: string): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { updatedAt: new Date().toISOString(), alerts: [] };
    }
    throw err;
  }
}

async function writeStore(filePath: string, store: StoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export async function appendAlert(alert: Alert): Promise<boolean> {
  const filePath = pathForChain(alert.chainId);
  const store = await readStore(filePath);
  if (store.alerts.some((a) => a.txHash === alert.txHash)) {
    console.log(`[jsonStore] skip duplicate ${alert.txHash}`);
    return false;
  }
  store.alerts.unshift(alert);
  store.updatedAt = new Date().toISOString();
  await writeStore(filePath, store);
  console.log(`[jsonStore] wrote alert ${alert.id} → ${filePath}`);
  return true;
}

// Resolve the alerts file path for a given chainId. Useful for ops scripts.
export function getAlertsFilePath(chainId?: number): string {
  return pathForChain(chainId);
}
