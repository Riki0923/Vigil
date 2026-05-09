// Address-to-name cache. Populated by the seed script after subnames are created;
// loaded by the agent at boot for fast in-line tagging of detected upgrades.
//
// Keys are lowercase Base Sepolia addresses; values are full ENS names (e.g. "demo.vigil.eth").

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type EnsTargetCache = Record<string, string>;

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..");
export const CACHE_PATH = path.join(REPO_ROOT, "data", "ens-targets.json");

export async function loadEnsCache(): Promise<EnsTargetCache> {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as EnsTargetCache;
    const normalized: EnsTargetCache = {};
    for (const [addr, name] of Object.entries(parsed)) {
      normalized[addr.toLowerCase()] = name;
    }
    return normalized;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[ens/cache] failed to read ${CACHE_PATH}:`, err);
    }
    return {};
  }
}

export async function saveEnsCache(cache: EnsTargetCache): Promise<void> {
  const normalized: EnsTargetCache = {};
  for (const [addr, name] of Object.entries(cache)) {
    normalized[addr.toLowerCase()] = name;
  }
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(normalized, null, 2) + "\n");
}

export function lookupName(cache: EnsTargetCache, address: string): string | null {
  return cache[address.toLowerCase()] ?? null;
}
