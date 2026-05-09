import { Bee, Topic, PrivateKey, NULL_STAMP, MantarayNode } from "@ethersphere/bee-js";
import { randomBytes } from "crypto";
import * as fs from "fs";

const BZZ_LIMO = "https://bzz.limo";
const MANIFEST_TOPIC_NAME = "vigil-manifest";
const STATE_FILE = ".swarm-manifest";

let bee: Bee;
let privateKey: PrivateKey;
let manifestTopic: Topic;

let node: MantarayNode;
let manifestReference: string | null = null;

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
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    console.log(`[Swarm] Loading existing manifest: ${state.reference}`);
    node = await MantarayNode.unmarshal(bee, state.reference);
    await node.loadRecursively(bee);
    manifestReference = state.reference;
    console.log(`[Swarm] Loaded manifest with ${node.collect().length} entries`);
  } else {
    console.log(`[Swarm] No state file found — starting fresh`);
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

    fs.writeFileSync(STATE_FILE, JSON.stringify({ reference: manifestReference }, null, 2));

    const writer = bee.makeFeedWriter(manifestTopic, privateKey);
    await writer.uploadReference(NULL_STAMP, saveResult.reference);

    const url = `${BZZ_LIMO}/bzz/${manifestReference}/blocks/${block.number}`;
    console.log(`[Swarm] Published: ${url}`);
    return url;
  } catch (err) {
    console.error(`[Swarm] Failed to publish data:`, err);
    return null;
  }
}

export function getManifestUrl(): string | null {
  if (!manifestReference) return null;
  return `${BZZ_LIMO}/bzz/${manifestReference}/`;
}
