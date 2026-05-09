// Server-side ENS reader for the dashboard. Resolves vigil.eth subnames on
// Ethereum Sepolia via viem, returns plain JSON the client can render.
//
// Mirrors src/ens/records.ts (agent runtime) but lives in the frontend tree
// because frontend uses viem, not ethers. Single source of truth for the
// keys is this file plus its agent-side counterpart.

import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;

const RECORD_KEYS = {
  description: "description",
  url: "url",
  capabilities: "vigil.capabilities",
  feed: "vigil.feed",
  payment: "vigil.payment",
  severityMin: "vigil.severity-min",
  kind: "vigil.kind",
  lastSeverity: "vigil.last-severity",
  lastUpgradeAt: "vigil.last-upgrade-at",
  lastTx: "vigil.last-tx",
  upgradeCount: "vigil.upgrade-count",
} as const;

// ENSIP-11 multichain coin type for Base Sepolia.
const BASE_SEPOLIA_COIN_TYPE = BigInt(0x80000000) | BigInt(84532);

export type AgentCapabilities = {
  watch: string[];
  chains: string[];
  output: string[];
};

export type AgentIdentity = {
  name: string;
  description: string | null;
  url: string | null;
  capabilities: AgentCapabilities | null;
  feed: string | null;
  payment: string | null;
  severityMin: string | null;
};

export type TargetReputation = {
  name: string;
  description: string | null;
  kind: string | null;
  baseSepoliaAddress: string | null;
  lastSeverity: string | null;
  lastUpgradeAt: string | null;
  lastTx: string | null;
  upgradeCount: number;
};

function getClient() {
  if (!SEPOLIA_RPC_URL) return null;
  return createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });
}

function parseCapabilities(raw: string | null): AgentCapabilities | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentCapabilities>;
    return {
      watch: Array.isArray(parsed.watch) ? parsed.watch.map(String) : [],
      chains: Array.isArray(parsed.chains) ? parsed.chains.map(String) : [],
      output: Array.isArray(parsed.output) ? parsed.output.map(String) : [],
    };
  } catch {
    return null;
  }
}

async function readText(
  client: NonNullable<ReturnType<typeof getClient>>,
  name: string,
  key: string,
): Promise<string | null> {
  try {
    const v = await client.getEnsText({ name, key });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function fetchAgentIdentity(
  name = "agent.vigil.eth",
): Promise<AgentIdentity | null> {
  const client = getClient();
  if (!client) return null;
  const [description, url, capabilitiesRaw, feed, payment, severityMin] = await Promise.all([
    readText(client, name, RECORD_KEYS.description),
    readText(client, name, RECORD_KEYS.url),
    readText(client, name, RECORD_KEYS.capabilities),
    readText(client, name, RECORD_KEYS.feed),
    readText(client, name, RECORD_KEYS.payment),
    readText(client, name, RECORD_KEYS.severityMin),
  ]);
  if (description === null && url === null && capabilitiesRaw === null) return null;
  return {
    name,
    description,
    url,
    capabilities: parseCapabilities(capabilitiesRaw),
    feed,
    payment,
    severityMin,
  };
}

export async function fetchTargetReputation(name: string): Promise<TargetReputation | null> {
  const client = getClient();
  if (!client) return null;
  const [description, kind, lastSeverity, lastUpgradeAt, lastTx, upgradeCountRaw, addrRaw] =
    await Promise.all([
      readText(client, name, RECORD_KEYS.description),
      readText(client, name, RECORD_KEYS.kind),
      readText(client, name, RECORD_KEYS.lastSeverity),
      readText(client, name, RECORD_KEYS.lastUpgradeAt),
      readText(client, name, RECORD_KEYS.lastTx),
      readText(client, name, RECORD_KEYS.upgradeCount),
      client
        .getEnsAddress({ name, coinType: BASE_SEPOLIA_COIN_TYPE })
        .catch(() => null),
    ]);
  const upgradeCount = upgradeCountRaw ? parseInt(upgradeCountRaw, 10) : 0;
  return {
    name,
    description,
    kind,
    baseSepoliaAddress: addrRaw && addrRaw !== "0x" ? addrRaw : null,
    lastSeverity,
    lastUpgradeAt,
    lastTx,
    upgradeCount: Number.isFinite(upgradeCount) ? upgradeCount : 0,
  };
}

export async function fetchTargetReputations(
  names: string[],
): Promise<Record<string, TargetReputation>> {
  const unique = Array.from(new Set(names));
  const reputations = await Promise.all(unique.map((n) => fetchTargetReputation(n)));
  const map: Record<string, TargetReputation> = {};
  for (let i = 0; i < unique.length; i++) {
    const rep = reputations[i];
    const key = unique[i];
    if (rep && key) map[key] = rep;
  }
  return map;
}

export const ENS_CONFIG = {
  parentName: process.env.VIGIL_PARENT_ENS_NAME ?? "vigil.eth",
  agentName: process.env.VIGIL_AGENT_ENS_NAME ?? "agent.vigil.eth",
  chainId: sepolia.id,
  appUrlBase: "https://app.ens.domains",
};
