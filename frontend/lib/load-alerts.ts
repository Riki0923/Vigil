import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Alert } from "./types";
import { mockAlerts } from "./mock-alerts";

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
    return { alerts: normalized, updatedAt: parsed.updatedAt };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[loadAlerts] failed to read ${filePath}:`, err);
    }
    return null;
  }
}

export async function loadAlerts(): Promise<LoadAlertsResult> {
  const [main, sepolia] = await Promise.all([
    readAlertsFile(ALERTS_FILE, BASE_CHAIN_ID),
    readAlertsFile(ALERTS_SEPOLIA_FILE, BASE_SEPOLIA_CHAIN_ID),
  ]);

  const merged: Alert[] = [];
  if (main) merged.push(...main.alerts);
  if (sepolia) merged.push(...sepolia.alerts);

  if (merged.length === 0) {
    return { alerts: mockAlerts, source: "mock" };
  }

  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const latestUpdated = [main?.updatedAt, sepolia?.updatedAt]
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  return { alerts: merged, source: "live", updatedAt: latestUpdated };
}
