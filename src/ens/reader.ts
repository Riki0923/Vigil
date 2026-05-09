// Forward resolution: name -> address + text records.
// Uses the ENS registry on Sepolia to find the resolver, then reads addr/text.

import { ethers } from "ethers";
import { ENS_RESOLVER_ABI, ENS_REGISTRY_ABI } from "./abi.js";
import {
  COIN_TYPE,
  getEnsContracts,
  getEnsProvider,
  type EnsNetwork,
} from "./client.js";

// The agent runtime resolves ENS against this network. Defaults to sepolia for
// backward compatibility; set VIGIL_ENS_NETWORK=mainnet to read from vigilbot.eth.
function getActiveNetwork(): EnsNetwork {
  const v = process.env.VIGIL_ENS_NETWORK?.toLowerCase();
  if (v === "mainnet") return "mainnet";
  return "sepolia";
}
import {
  parseCapabilities,
  parseSeverity,
  RECORD_KEYS,
  type AgentEnsConfig,
  type TargetEnsConfig,
} from "./records.js";

async function getResolverFor(name: string): Promise<ethers.Contract | null> {
  const network = getActiveNetwork();
  const provider = getEnsProvider(network);
  const contracts = getEnsContracts(network);
  const registry = new ethers.Contract(contracts.registry, ENS_REGISTRY_ABI, provider);
  const node = ethers.namehash(name);
  const resolverAddr = (await registry.getFunction("resolver")(node)) as string;
  if (!resolverAddr || resolverAddr === ethers.ZeroAddress) return null;
  return new ethers.Contract(resolverAddr, ENS_RESOLVER_ABI, provider);
}

async function readText(
  resolver: ethers.Contract,
  node: string,
  key: string,
): Promise<string | null> {
  try {
    const value = (await resolver.getFunction("text")(node, key)) as string;
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readMultichainAddress(
  resolver: ethers.Contract,
  node: string,
  coinType: bigint,
): Promise<string | null> {
  try {
    const raw = (await resolver.getFunction("addr(bytes32,uint256)")(node, coinType)) as string;
    if (!raw || raw === "0x") return null;
    if (raw.length !== 42) return null;
    return ethers.getAddress(raw);
  } catch {
    return null;
  }
}

export async function resolveAgentConfig(name: string): Promise<AgentEnsConfig | null> {
  const resolver = await getResolverFor(name);
  if (!resolver) return null;
  const node = ethers.namehash(name);

  const [description, url, capabilitiesRaw, feed, payment, severityRaw] = await Promise.all([
    readText(resolver, node, RECORD_KEYS.description),
    readText(resolver, node, RECORD_KEYS.url),
    readText(resolver, node, RECORD_KEYS.capabilities),
    readText(resolver, node, RECORD_KEYS.feed),
    readText(resolver, node, RECORD_KEYS.payment),
    readText(resolver, node, RECORD_KEYS.severityMin),
  ]);

  return {
    description,
    url,
    capabilities: parseCapabilities(capabilitiesRaw),
    feed,
    payment,
    severityMin: parseSeverity(severityRaw),
  };
}

export async function resolveTargetConfig(name: string): Promise<TargetEnsConfig | null> {
  const resolver = await getResolverFor(name);
  if (!resolver) return null;
  const node = ethers.namehash(name);
  // Read whichever Base coinType matches the active network; the field is
  // named `baseSepoliaAddress` for backward compat but holds either chain.
  const network = getActiveNetwork();
  const baseCoinType =
    network === "mainnet" ? COIN_TYPE.baseMainnet : COIN_TYPE.baseSepolia;

  const [description, kind, feed, addr] = await Promise.all([
    readText(resolver, node, RECORD_KEYS.description),
    readText(resolver, node, RECORD_KEYS.kind),
    readText(resolver, node, RECORD_KEYS.feed),
    readMultichainAddress(resolver, node, baseCoinType),
  ]);

  return {
    description,
    kind,
    feed,
    baseSepoliaAddress: addr,
  };
}

// Lightweight existence check used by scripts before write ops.
// Defaults to the active VIGIL_ENS_NETWORK (or sepolia if unset).
// Pass network explicitly when seeding/registering against a specific chain.
export async function isNameRegistered(
  name: string,
  network: EnsNetwork = getActiveNetwork(),
): Promise<boolean> {
  const provider = getEnsProvider(network);
  const contracts = getEnsContracts(network);
  const registry = new ethers.Contract(contracts.registry, ENS_REGISTRY_ABI, provider);
  const node = ethers.namehash(name);
  const owner = (await registry.getFunction("owner")(node)) as string;
  return owner !== ethers.ZeroAddress;
}
