// Vigil-specific Swarm publisher. Delegates block archival to the standalone
// `chain-archive` library; this module just owns the keypair plumbing and
// the {alert, block} envelope shape Vigil writes for each upgrade.

import { Bee, PrivateKey, Topic } from "@ethersphere/bee-js";
import { randomBytes } from "crypto";
import { ChainArchive } from "../libs/chain-archive/index.js";

const BZZ_LIMO = "https://bzz.limo";
// Pinned topic, keeps Vigil's published feed URL stable across the
// chain-archive extraction. Subscribers find this URL via vigil.feed
// on agent.vigil.eth; changing the string would break discovery.
const VIGIL_MANIFEST_TOPIC = Topic.fromString("vigil-manifest");

let archive: ChainArchive | null = null;

export async function initSwarm(): Promise<void> {
  const rawKey = process.env.SWARM_PRIVATE_KEY;
  let privateKey: PrivateKey;

  if (rawKey) {
    privateKey = new PrivateKey(Buffer.from(rawKey.replace(/^0x/, ""), "hex"));
    console.log(`[Swarm] Loaded private key from SWARM_PRIVATE_KEY`);
  } else {
    const generated = randomBytes(32);
    privateKey = new PrivateKey(generated);
    console.log(`[Swarm] No SWARM_PRIVATE_KEY found, generated new key:`);
    console.log(`[Swarm] SWARM_PRIVATE_KEY=${generated.toString("hex")}`);
    console.log(`[Swarm] Save this in your .env to keep the same feed across restarts`);
  }

  archive = new ChainArchive({
    bee: new Bee(BZZ_LIMO),
    privateKey,
    topic: VIGIL_MANIFEST_TOPIC,
    gatewayUrl: BZZ_LIMO,
  });

  try {
    await archive.init();
    console.log(`[Swarm] PERMANENT FEED URL: ${archive.getFeedUrl()}`);
    const archived = archive.listBlocks();
    if (archived.length > 0) {
      console.log(`[Swarm] Resumed existing manifest with ${archived.length} entries`);
    } else {
      console.log(`[Swarm] No existing manifest, starting fresh`);
    }
  } catch (err) {
    console.warn(
      `[Swarm] init failed, continuing with empty manifest:`,
      (err as Error)?.message ?? err,
    );
  }
}

export async function publishData(alert: any, block: any): Promise<string | null> {
  if (!archive) {
    console.warn(`[Swarm] Not initialised, call initSwarm() first`);
    return null;
  }

  try {
    const result = await archive.archiveBlock(block.number, { alert, block });

    console.log(`[Swarm] Published: ${result.url}`);
    console.log(`[Swarm] Feed URL: ${archive.getFeedUrl()}`);

    const archived = archive.listBlocks();
    // console.log(`[Swarm] All manifest entries (${archived.length}):`);
    for (const n of archived) {
      // console.log(`  - blocks/${n}`);
    }

    return result.url;
  } catch (err) {
    console.error(`[Swarm] Failed to publish data:`, err);
    return null;
  }
}

export function getFeedUrl(): string | null {
  return archive?.getFeedUrl() ?? null;
}
