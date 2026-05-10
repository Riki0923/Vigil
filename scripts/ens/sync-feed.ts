// Computes the deterministic Swarm feed URL from SWARM_PRIVATE_KEY +
// MANIFEST_TOPIC_NAME and writes it to agent.<parent>'s `vigil.feed` text
// record. Run this once after pinning SWARM_PRIVATE_KEY, or any time the
// key rotates.
//
// Network defaults to sepolia for backward compat; pass --network=mainnet
// to write to agent.vigilbot.eth on Ethereum mainnet.
//
// Subscribers discover the feed via ENS:
//   tsx scripts/ens/resolve.ts agent.vigilbot.eth --network=mainnet
//     → vigil.feed: https://bzz.limo/feeds/...
//
// Usage:
//   tsx scripts/ens/sync-feed.ts                                    (sepolia)
//   tsx scripts/ens/sync-feed.ts --network=mainnet                  (mainnet)

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { PrivateKey, Topic } from "@ethersphere/bee-js";

import {
  ENS_RESOLVER_ABI,
  ENS_REGISTRY_ABI,
  RECORD_KEYS,
  getEnsContracts,
  getEnsSigner,
  type EnsNetwork,
} from "../../src/ens/index.js";

dotenv.config();

const MANIFEST_TOPIC_NAME = "vigil-manifest";
const BZZ_LIMO = "https://bzz.limo";

function parseNetworkFlag(): EnsNetwork {
  const flag = process.argv.find((a) => a.startsWith("--network="));
  const value = flag ? flag.slice("--network=".length) : "sepolia";
  if (value !== "sepolia" && value !== "mainnet") {
    throw new Error(`--network must be "sepolia" or "mainnet" (got "${value}")`);
  }
  return value;
}

function getDefaultAgentName(network: EnsNetwork): string {
  if (network === "mainnet") {
    return (
      process.env.VIGIL_AGENT_ENS_NAME_MAINNET ??
      `agent.${process.env.VIGIL_PARENT_ENS_NAME_MAINNET ?? "vigilbot.eth"}`
    );
  }
  return process.env.VIGIL_AGENT_ENS_NAME ?? "agent.vigil.eth";
}

function computeFeedUrl(): string {
  const raw = process.env.SWARM_PRIVATE_KEY;
  if (!raw) {
    throw new Error("SWARM_PRIVATE_KEY is not set, pin it in .env first");
  }
  const pk = new PrivateKey(Buffer.from(raw.replace(/^0x/, ""), "hex"));
  const owner = pk.publicKey().address().toChecksum();
  const topic = Topic.fromString(MANIFEST_TOPIC_NAME);
  return `${BZZ_LIMO}/feeds/${owner}/${topic.toHex()}`;
}

async function main(): Promise<void> {
  const network = parseNetworkFlag();
  const agentName = getDefaultAgentName(network);
  const feedUrl = computeFeedUrl();
  const contracts = getEnsContracts(network);
  const signer = getEnsSigner(network);

  console.log(`[sync-feed] Network:     ${network} (chainId ${contracts.chainId})`);
  console.log(`[sync-feed] Target name: ${agentName}`);
  console.log(`[sync-feed] Feed URL:    ${feedUrl}`);

  const node = ethers.namehash(agentName);
  const registry = new ethers.Contract(contracts.registry, ENS_REGISTRY_ABI, signer);
  const resolverAddr = (await registry.getFunction("resolver")(node)) as string;
  if (!resolverAddr || resolverAddr === ethers.ZeroAddress) {
    throw new Error(
      `No resolver set for ${agentName}, run tsx scripts/ens/seed-subnames.ts --network=${network} first`,
    );
  }
  const resolver = new ethers.Contract(resolverAddr, ENS_RESOLVER_ABI, signer);

  console.log(`[sync-feed] Writing text[${RECORD_KEYS.feed}]...`);
  const tx = await resolver.getFunction("setText")(node, RECORD_KEYS.feed, feedUrl);
  console.log(`[sync-feed] Tx: ${tx.hash}`);
  await tx.wait();
  console.log(`[sync-feed] ✅ vigil.feed published on ${agentName}`);
  console.log(`[sync-feed] Verify: tsx scripts/ens/resolve.ts ${agentName} --network=${network}`);
}

main().catch((err) => {
  console.error("[sync-feed] Fatal:", err.shortMessage ?? err.message ?? err);
  process.exit(1);
});
