import axios from "axios";

const FOURBYTE_URL = "https://api.4byte.sourcify.dev/v1/signatures";

const CRITICAL_NAMES = new Set([
  "withdraw", "withdrawAll", "withdrawTo", "withdrawFunds",
  "transfer", "transferFrom", "transferOwnership",
  "migrate", "migration",
  "upgrade", "upgradeTo", "upgradeToAndCall",
  "selfdestruct", "destroy", "kill",
]);

export interface ABIItem {
  type: string;
  name?: string;
  inputs?: ABIParam[];
  outputs?: ABIParam[];
  stateMutability?: string;
}

export interface ABIParam {
  name: string;
  type: string;
  components?: ABIParam[];
}

export interface ModifiedFunction {
  name: string;
  old: ABIItem;
  new: ABIItem;
}

export interface ABIDiff {
  addedFunctions: ABIItem[];
  removedFunctions: ABIItem[];
  modifiedFunctions: ModifiedFunction[];
}

export interface RiskFlag {
  level: "CRITICAL" | "HIGH" | "MEDIUM";
  message: string;
}

function itemKey(item: ABIItem): string {
  return `${item.type}:${item.name ?? ""}`;
}

function signatureOf(item: ABIItem): string {
  const params = (item.inputs ?? []).map((p) => p.type).join(",");
  return `${item.name ?? ""}(${params})`;
}

function paramsEqual(a: ABIParam[] = [], b: ABIParam[] = []): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffABIs(oldABI: ABIItem[], newABI: ABIItem[]): ABIDiff {
  const relevant = (item: ABIItem) =>
    item.type === "function" || item.type === "event" || item.type === "error";

  const oldItems = oldABI.filter(relevant);
  const newItems = newABI.filter(relevant);

  const oldMap = new Map<string, ABIItem>(oldItems.map((i) => [itemKey(i), i]));
  const newMap = new Map<string, ABIItem>(newItems.map((i) => [itemKey(i), i]));

  const addedFunctions: ABIItem[] = [];
  const removedFunctions: ABIItem[] = [];
  const modifiedFunctions: ModifiedFunction[] = [];

  for (const [key, newItem] of newMap) {
    const oldItem = oldMap.get(key);
    if (!oldItem) {
      addedFunctions.push(newItem);
    } else if (
      !paramsEqual(oldItem.inputs, newItem.inputs) ||
      !paramsEqual(oldItem.outputs, newItem.outputs)
    ) {
      modifiedFunctions.push({ name: newItem.name ?? key, old: oldItem, new: newItem });
    }
  }

  for (const [key, oldItem] of oldMap) {
    if (!newMap.has(key)) removedFunctions.push(oldItem);
  }

  logABIDiff({ addedFunctions, removedFunctions, modifiedFunctions });

  return { addedFunctions, removedFunctions, modifiedFunctions };
}

export function assessFunctionRisk(diff: ABIDiff): RiskFlag[] {
  const flags: RiskFlag[] = [];

  const criticalHits = [
    ...diff.addedFunctions,
    ...diff.modifiedFunctions.map((m) => m.new),
  ].filter((item) => item.name && CRITICAL_NAMES.has(item.name.toLowerCase()));

  for (const item of criticalHits) {
    flags.push({
      level: "CRITICAL",
      message: `Sensitive function "${item.name ?? ""}" (${signatureOf(item)}) was added or modified`,
    });
  }

  if (diff.removedFunctions.length > 0) {
    const names = diff.removedFunctions.map((f) => f.name ?? f.type).join(", ");
    flags.push({
      level: "HIGH",
      message: `${diff.removedFunctions.length} function(s) removed: ${names}`,
    });
  }

  if (diff.addedFunctions.length > 0) {
    const names = diff.addedFunctions.map((f) => f.name ?? f.type).join(", ");
    flags.push({
      level: "MEDIUM",
      message: `${diff.addedFunctions.length} function(s) added: ${names}`,
    });
  }

  return flags;
}

interface FourByteResult {
  results: Array<{ text_signature: string; hex_signature: string }>;
}

export async function lookupSignatures(
  signatures: string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  await Promise.all(
    signatures.map(async (hex) => {
      try {
        const { data } = await axios.get<FourByteResult>(FOURBYTE_URL, {
          params: { hex_signature: hex },
        });
        const match = data.results[0];
        if (match) {
          resolved.set(hex, match.text_signature);
          console.log(`[4byte] ${hex} → ${match.text_signature}`);
        } else {
          console.log(`[4byte] ${hex} → unknown`);
        }
      } catch (err) {
        console.error(`[4byte] Lookup failed for ${hex}:`, err);
      }
    })
  );

  return resolved;
}

function logABIDiff(diff: ABIDiff): void {
  const line = "─".repeat(60);
  console.log(`\n[ABIDiff] ${line}`);

  if (
    diff.addedFunctions.length === 0 &&
    diff.removedFunctions.length === 0 &&
    diff.modifiedFunctions.length === 0
  ) {
    console.log(`[ABIDiff] No changes detected, ABIs are identical`);
    console.log(`[ABIDiff] ${line}`);
    return;
  }

  if (diff.modifiedFunctions.length > 0) {
    console.log(`[ABIDiff] MODIFIED (${diff.modifiedFunctions.length}):`);
    for (const m of diff.modifiedFunctions) {
      console.log(`  ${m.name}`);
      console.log(`    old: (${(m.old.inputs ?? []).map((p) => p.type).join(", ")})`);
      console.log(`    new: (${(m.new.inputs ?? []).map((p) => p.type).join(", ")})`);
    }
  }

  if (diff.removedFunctions.length > 0) {
    console.log(`[ABIDiff] REMOVED (${diff.removedFunctions.length}):`);
    for (const f of diff.removedFunctions) {
      console.log(`  ${signatureOf(f)} [${f.type}]`);
    }
  }

  if (diff.addedFunctions.length > 0) {
    console.log(`[ABIDiff] ADDED (${diff.addedFunctions.length}):`);
    for (const f of diff.addedFunctions) {
      console.log(`  ${signatureOf(f)} [${f.type}]`);
    }
  }

  console.log(`[ABIDiff] ${line}`);
}
