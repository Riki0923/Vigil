// Computes the deterministic Swarm feed URL from SWARM_PRIVATE_KEY +
// MANIFEST_TOPIC_NAME and writes it to agent.vigil.eth's `vigil.feed` text
// record on Ethereum Sepolia. Run this once after pinning SWARM_PRIVATE_KEY,
// or any time the key rotates.
//
// Subscribers discover the feed via ENS:
//   tsx scripts/ens/resolve.ts agent.vigil.eth   →   vigil.feed: https://bzz.limo/feeds/...
//
// Usage: tsx scripts/ens/sync-feed.ts

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { PrivateKey, Topic } from "@ethersphere/bee-js";

import {
  ENS_RESOLVER_ABI,
  ENS_REGISTRY_ABI,
  ENS_SEPOLIA,
  RECORD_KEYS,
  getSepoliaSigner,
} from "../../src/ens/index.js";

dotenv.config();

const AGENT_NAME = process.env.VIGIL_AGENT_ENS_NAME ?? "agent.vigil.eth";
const MANIFEST_TOPIC_NAME = "vigil-manifest";
const BZZ_LIMO = "https://bzz.limo";

function computeFeedUrl(): string {
  const raw = process.env.SWARM_PRIVATE_KEY;
  if (!raw) {
    throw new Error("SWARM_PRIVATE_KEY is not set — pin it in .env first");
  }
  const pk = new PrivateKey(Buffer.from(raw.replace(/^0x/, ""), "hex"));
  const owner = pk.publicKey().address().toChecksum();
  const topic = Topic.fromString(MANIFEST_TOPIC_NAME);
  return `${BZZ_LIMO}/feeds/${owner}/${topic.toHex()}`;
}

async function main(): Promise<void> {
  const feedUrl = computeFeedUrl();
  console.log(`[sync-feed] Target name: ${AGENT_NAME}`);
  console.log(`[sync-feed] Feed URL:    ${feedUrl}`);

  const signer = getSepoliaSigner();
  const node = ethers.namehash(AGENT_NAME);
  const registry = new ethers.Contract(ENS_SEPOLIA.registry, ENS_REGISTRY_ABI, signer);
  const resolverAddr = (await registry.getFunction("resolver")(node)) as string;
  if (!resolverAddr || resolverAddr === ethers.ZeroAddress) {
    throw new Error(`No resolver set for ${AGENT_NAME} — run npm run ens:seed first`);
  }
  const resolver = new ethers.Contract(resolverAddr, ENS_RESOLVER_ABI, signer);

  console.log(`[sync-feed] Writing text[${RECORD_KEYS.feed}]...`);
  const tx = await resolver.getFunction("setText")(node, RECORD_KEYS.feed, feedUrl);
  console.log(`[sync-feed] Tx: ${tx.hash}`);
  await tx.wait();
  console.log(`[sync-feed] ✅ vigil.feed published on ${AGENT_NAME}`);
  console.log(`[sync-feed] Verify: npm run ens:resolve ${AGENT_NAME}`);
}

main().catch((err) => {
  console.error("[sync-feed] Fatal:", err.shortMessage ?? err.message ?? err);
  process.exit(1);
});
