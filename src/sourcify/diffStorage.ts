import { AlertSeverity } from "../alerts/index.js";
import type { StorageLayout, StorageLayoutEntry } from "./index.js";

export interface MovedVariable {
  label: string;
  oldSlot: string;
  newSlot: string;
  oldOffset: number;
  newOffset: number;
}

export interface DiffResult {
  removedVariables: StorageLayoutEntry[];
  addedVariables: StorageLayoutEntry[];
  movedVariables: MovedVariable[];
}

export function diffStorageLayouts(
  oldLayout: StorageLayout,
  newLayout: StorageLayout
): DiffResult {
  const oldMap = new Map<string, StorageLayoutEntry>(
    oldLayout.storage.map((e) => [e.label, e])
  );
  const newMap = new Map<string, StorageLayoutEntry>(
    newLayout.storage.map((e) => [e.label, e])
  );

  const removedVariables: StorageLayoutEntry[] = [];
  const movedVariables: MovedVariable[] = [];

  for (const [label, oldEntry] of oldMap) {
    const newEntry = newMap.get(label);
    if (!newEntry) {
      removedVariables.push(oldEntry);
    } else if (oldEntry.slot !== newEntry.slot || oldEntry.offset !== newEntry.offset) {
      movedVariables.push({
        label,
        oldSlot: oldEntry.slot,
        newSlot: newEntry.slot,
        oldOffset: oldEntry.offset,
        newOffset: newEntry.offset,
      });
    }
  }

  const addedVariables: StorageLayoutEntry[] = [];
  for (const [label, newEntry] of newMap) {
    if (!oldMap.has(label)) {
      addedVariables.push(newEntry);
    }
  }

  logDiff({ removedVariables, addedVariables, movedVariables });

  return { removedVariables, addedVariables, movedVariables };
}

export function assessRisk(diff: DiffResult): AlertSeverity {
  if (diff.movedVariables.length > 0) return AlertSeverity.CRITICAL;
  if (diff.removedVariables.length > 0) return AlertSeverity.HIGH;
  if (diff.addedVariables.length > 0) return AlertSeverity.MEDIUM;
  return AlertSeverity.LOW;
}

function logDiff(diff: DiffResult): void {
  const line = "─".repeat(60);
  console.log(`\n[StorageDiff] ${line}`);

  if (
    diff.movedVariables.length === 0 &&
    diff.removedVariables.length === 0 &&
    diff.addedVariables.length === 0
  ) {
    console.log(`[StorageDiff] No changes detected, layouts are identical`);
    console.log(`[StorageDiff] ${line}`);
    return;
  }

  if (diff.movedVariables.length > 0) {
    console.log(`[StorageDiff] MOVED (${diff.movedVariables.length}), storage collision risk:`);
    for (const v of diff.movedVariables) {
      console.log(`  ${v.label}: slot ${v.oldSlot}+${v.oldOffset} → slot ${v.newSlot}+${v.newOffset}`);
    }
  }

  if (diff.removedVariables.length > 0) {
    console.log(`[StorageDiff] REMOVED (${diff.removedVariables.length}):`);
    for (const v of diff.removedVariables) {
      console.log(`  ${v.label} (slot ${v.slot}, offset ${v.offset}, type ${v.type})`);
    }
  }

  if (diff.addedVariables.length > 0) {
    console.log(`[StorageDiff] ADDED (${diff.addedVariables.length}):`);
    for (const v of diff.addedVariables) {
      console.log(`  ${v.label} (slot ${v.slot}, offset ${v.offset}, type ${v.type})`);
    }
  }

  console.log(`[StorageDiff] ${line}`);
}
