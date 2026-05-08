import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Alert } from "../alerts/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const ALERTS_FILE = path.join(DATA_DIR, "alerts.json");

type StoreShape = {
  updatedAt: string;
  alerts: Alert[];
};

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(ALERTS_FILE, "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { updatedAt: new Date().toISOString(), alerts: [] };
    }
    throw err;
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${ALERTS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, ALERTS_FILE);
}

export async function appendAlert(alert: Alert): Promise<boolean> {
  const store = await readStore();
  if (store.alerts.some((a) => a.txHash === alert.txHash)) {
    console.log(`[jsonStore] skip duplicate ${alert.txHash}`);
    return false;
  }
  store.alerts.unshift(alert);
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  console.log(`[jsonStore] wrote alert ${alert.id} → ${ALERTS_FILE}`);
  return true;
}

export function getAlertsFilePath(): string {
  return ALERTS_FILE;
}
