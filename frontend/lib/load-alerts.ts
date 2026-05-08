import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Alert } from "./types";
import { mockAlerts } from "./mock-alerts";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../..");
const ALERTS_FILE = path.join(REPO_ROOT, "data", "alerts.json");

export type LoadAlertsResult = {
  alerts: Alert[];
  source: "live" | "mock";
  updatedAt?: string;
};

export async function loadAlerts(): Promise<LoadAlertsResult> {
  try {
    const raw = await fs.readFile(ALERTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as { alerts: Alert[]; updatedAt: string };
    if (parsed.alerts && parsed.alerts.length > 0) {
      return { alerts: parsed.alerts, source: "live", updatedAt: parsed.updatedAt };
    }
    return { alerts: mockAlerts, source: "mock" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[loadAlerts] failed to read alerts.json:", err);
    }
    return { alerts: mockAlerts, source: "mock" };
  }
}
