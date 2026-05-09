import { Bee, Topic, PrivateKey, NULL_STAMP, MantarayNode } from "@ethersphere/bee-js";
import { randomBytes } from "crypto";

const BZZ_LIMO = "https://bzz.limo";
const MANIFEST_TOPIC_NAME = "vigil-manifest";

let bee: Bee;
let privateKey: PrivateKey;
let manifestTopic: Topic;

let node: MantarayNode;
let manifestReference: string | null = null;
let feedManifestUrl: string | null = null;

export async function initSwarm(): Promise<void> {
  bee = new Bee(BZZ_LIMO);

  const rawKey = process.env.SWARM_PRIVATE_KEY;

  if (rawKey) {
    privateKey = new PrivateKey(Buffer.from(rawKey.replace(/^0x/, ""), "hex"));
    console.log(`[Swarm] Loaded private key from SWARM_PRIVATE_KEY`);
  } else {
    const generated = randomBytes(32);
    privateKey = new PrivateKey(generated);
    console.log(`[Swarm] No SWARM_PRIVATE_KEY found — generated new key:`);
    console.log(`[Swarm] SWARM_PRIVATE_KEY=${generated.toString("hex")}`);
    console.log(`[Swarm] Save this in your .env to keep the same feed across restarts`);
  }

  manifestTopic = Topic.fromString(MANIFEST_TOPIC_NAME);

  const feedWriter = bee.makeFeedWriter(manifestTopic, privateKey);
  const feedManifest = await bee.createFeedManifest(NULL_STAMP, manifestTopic, feedWriter.owner);
  feedManifestUrl = `${BZZ_LIMO}/bzz/${feedManifest.toHex()}/`;
  console.log(`[Swarm] PERMANENT FEED URL: ${feedManifestUrl}`);

  try {
    const { reference } = await feedWriter.downloadReference();
    node = await MantarayNode.unmarshal(bee, reference);
    await node.loadRecursively(bee);
    manifestReference = reference.toHex();
    console.log(`[Swarm] Resumed existing manifest with ${node.collect().length} entries`);
  } catch (err: any) {
    if (err?.status === 404 || err?.message?.includes("404")) {
      console.log(`[Swarm] No existing manifest — starting fresh`);
    } else {
      console.warn(`[Swarm] Could not load existing manifest — starting fresh:`, err?.message);
    }
    node = new MantarayNode();
  }

  console.log(`[Swarm] Manifest feed topic: ${MANIFEST_TOPIC_NAME} (${manifestTopic.toHex()})`);
  console.log(`[Swarm] Gateway: ${BZZ_LIMO}`);
}

export async function publishData(alert: any, block: any): Promise<string | null> {
  if (!bee || !privateKey || !node) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  try {
    const combined = { alert, block };
    const result = await bee.uploadData(NULL_STAMP, JSON.stringify(combined));

    node.addFork(
      "blocks/" + block.number,
      result.reference,
      { "Content-Type": "application/json", Filename: String(block.number) },
    );

    const saveResult = await node.saveRecursively(bee, NULL_STAMP);
    manifestReference = saveResult.reference.toHex();

    const feedWriter = bee.makeFeedWriter(manifestTopic, privateKey);
    await feedWriter.uploadReference(NULL_STAMP, saveResult.reference);

    const url = `${BZZ_LIMO}/bzz/${manifestReference}/blocks/${block.number}`;
    console.log(`[Swarm] Published: ${url}`);
    console.log(`[Swarm] Feed URL: ${feedManifestUrl}`);
    console.log("Feed updated");

    const entries = node.collect();
    console.log(`[Swarm] All manifest entries (${entries.length}):`);
    for (const entry of entries) {
      console.log(`  - ${entry.fullPathString}`);
    }

    return url;
  } catch (err) {
    console.error(`[Swarm] Failed to publish data:`, err);
    return null;
  }
}

export function getFeedUrl(): string | null {
  return feedManifestUrl;
}
