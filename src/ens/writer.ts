// Writes alert metadata back to ENS as text records on the relevant target subname.
// Each alert produced by the agent for a known target updates the subname's
// records, turning ENS into a live, on-chain reputation log for monitored
// protocols. Other agents can `resolve usdc.vigil.eth` and read whether Vigil
// has flagged it recently — agent-to-agent discovery via ENS records.

import { ethers } from "ethers";
import { ENS_RESOLVER_ABI, ENS_REGISTRY_ABI } from "./abi.js";
import {
  getEnsContracts,
  getEnsProvider,
  getEnsSigner,
  type EnsNetwork,
} from "./client.js";

const REPUTATION_KEYS = {
  lastSeverity: "vigil.last-severity",
  lastUpgradeAt: "vigil.last-upgrade-at",
  lastTx: "vigil.last-tx",
  upgradeCount: "vigil.upgrade-count",
} as const;

export type ReputationUpdate = {
  severity: string;
  timestamp: string;
  txHash: string;
};

// Mirrors getActiveNetwork() in reader.ts — kept inline to avoid circular
// imports between reader and writer. Defaults to mainnet (production parent
// vigilbot.eth); set VIGIL_ENS_NETWORK=sepolia to write to vigil.eth instead.
function getActiveNetwork(): EnsNetwork {
  const v = process.env.VIGIL_ENS_NETWORK?.toLowerCase();
  if (v === "sepolia") return "sepolia";
  return "mainnet";
}

// Returns true if the writer can run (ENS_REGISTRAR_PRIVATE_KEY is set).
export function hasEnsWriter(): boolean {
  return Boolean(process.env.ENS_REGISTRAR_PRIVATE_KEY);
}

async function readUpgradeCount(name: string): Promise<number> {
  const network = getActiveNetwork();
  const provider = getEnsProvider(network);
  const contracts = getEnsContracts(network);
  const registry = new ethers.Contract(contracts.registry, ENS_REGISTRY_ABI, provider);
  const node = ethers.namehash(name);
  const resolverAddr = (await registry.getFunction("resolver")(node)) as string;
  if (!resolverAddr || resolverAddr === ethers.ZeroAddress) return 0;
  const resolver = new ethers.Contract(resolverAddr, ENS_RESOLVER_ABI, provider);
  try {
    const raw = (await resolver.getFunction("text")(node, REPUTATION_KEYS.upgradeCount)) as string;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Updates the four reputation text records on `name` (which must be a vigil
// subname this signer can write to). All four setText calls share a single
// nonce-managed signer so they execute sequentially in one block where possible.
export async function updateTargetReputation(
  name: string,
  update: ReputationUpdate,
): Promise<void> {
  const network = getActiveNetwork();
  const signer = getEnsSigner(network);
  const contracts = getEnsContracts(network);
  const node = ethers.namehash(name);

  // Resolve via registry to be robust to subname-specific resolvers.
  const registry = new ethers.Contract(contracts.registry, ENS_REGISTRY_ABI, signer);
  const resolverAddr = (await registry.getFunction("resolver")(node)) as string;
  if (!resolverAddr || resolverAddr === ethers.ZeroAddress) {
    throw new Error(`No resolver set for ${name} — cannot write reputation records`);
  }
  const resolver = new ethers.Contract(resolverAddr, ENS_RESOLVER_ABI, signer);

  const prevCount = await readUpgradeCount(name);
  const newCount = prevCount + 1;

  console.log(
    `[ens/writer] ${name} ← severity=${update.severity} tx=${update.txHash.slice(0, 10)}… count ${prevCount}→${newCount}`,
  );

  const setText = resolver.getFunction("setText");
  // Sequential awaits — ethers handles nonce; parallel txs would race on nonce.
  const tx1 = await setText(node, REPUTATION_KEYS.lastSeverity, update.severity);
  await tx1.wait();
  const tx2 = await setText(node, REPUTATION_KEYS.lastUpgradeAt, update.timestamp);
  await tx2.wait();
  const tx3 = await setText(node, REPUTATION_KEYS.lastTx, update.txHash);
  await tx3.wait();
  const tx4 = await setText(node, REPUTATION_KEYS.upgradeCount, String(newCount));
  await tx4.wait();

  console.log(`[ens/writer] ${name} reputation updated (4 txs confirmed)`);
}
