import { Bee, Topic, PrivateKey, NULL_STAMP, MantarayNode } from "@ethersphere/bee-js";
import { randomBytes } from "crypto";

const BZZ_LIMO = "https://bzz.limo";
const MANIFEST_TOPIC_NAME = "vigil-manifest";

let bee: Bee;
let privateKey: PrivateKey;
let manifestTopic: Topic;
let ownerAddress: string;

let currentManifest: MantarayNode | null = null;
let manifestReference: string | null = null;

export async function initSwarm(): Promise<void> {
  bee = new Bee(BZZ_LIMO);

  const rawKey = process.env.SWARM_PRIVATE_KEY;
  let keyWasProvided = false;

  if (rawKey) {
    privateKey = new PrivateKey(Buffer.from(rawKey.replace(/^0x/, ""), "hex"));
    keyWasProvided = true;
    console.log(`[Swarm] Loaded private key from SWARM_PRIVATE_KEY`);
  } else {
    const generated = randomBytes(32);
    privateKey = new PrivateKey(generated);
    console.log(`[Swarm] No SWARM_PRIVATE_KEY found — generated new key:`);
    console.log(`[Swarm] SWARM_PRIVATE_KEY=${generated.toString("hex")}`);
    console.log(`[Swarm] Save this in your .env to keep the same feed across restarts`);
  }

  manifestTopic = Topic.fromString(MANIFEST_TOPIC_NAME);
  ownerAddress = privateKey.publicKey().address().toChecksum();

  if (keyWasProvided) {
    try {
      const reader = bee.makeFeedReader(manifestTopic, ownerAddress);
      const { reference } = await reader.downloadReference();
      const node = await MantarayNode.unmarshal(bee, reference);
      await node.loadRecursively(bee);
      currentManifest = node;
      manifestReference = reference.toHex();
      console.log(`[Swarm] Resumed existing manifest: ${BZZ_LIMO}/bzz/${manifestReference}/`);
    } catch {
      console.log(`[Swarm] No existing manifest found — starting fresh`);
      currentManifest = new MantarayNode();
    }
  } else {
    currentManifest = new MantarayNode();
  }

  console.log(`[Swarm] Manifest feed topic: ${MANIFEST_TOPIC_NAME} (${manifestTopic.toHex()})`);
  console.log(`[Swarm] Gateway: ${BZZ_LIMO}`);
}

async function saveManifest(): Promise<void> {
  if (!currentManifest) return;

  const result = await currentManifest.saveRecursively(bee, NULL_STAMP);
  const reference = result.reference;

  const writer = bee.makeFeedWriter(manifestTopic, privateKey);
  await writer.uploadReference(NULL_STAMP, reference);

  manifestReference = reference.toHex();
  console.log(`[Swarm] Manifest updated: ${BZZ_LIMO}/bzz/${manifestReference}/`);
}

export async function publishAlert(alert: any): Promise<string | null> {
  if (!bee || !privateKey || !currentManifest) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  try {
    const json = JSON.stringify(alert);
    const uploadResult = await bee.uploadFile(NULL_STAMP, Buffer.from(json), "alert.json", { contentType: "application/json" });
    const reference = uploadResult.reference;

    const encoder = new TextEncoder();
    currentManifest.addFork(
      encoder.encode(`/alerts/${alert.id}`),
      reference.toUint8Array(),
      { "Content-Type": "application/json", Filename: String(alert.id) },
    );
    await saveManifest();

    const url = `${BZZ_LIMO}/bzz/${reference.toHex()}`;
    console.log(`[Swarm] Alert published: ${url}`);
    return url;
  } catch (err) {
    console.error(`[Swarm] Failed to publish alert:`, err);
    return null;
  }
}

export async function publishBlock(blockData: any, blockNumber: number): Promise<string | null> {
  if (!bee || !privateKey || !currentManifest) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  try {
    const json = JSON.stringify(blockData);
    const uploadResult = await bee.uploadFile(NULL_STAMP, Buffer.from(json), "block.json", { contentType: "application/json" });
    const reference = uploadResult.reference;

    const encoder = new TextEncoder();
    currentManifest.addFork(
      encoder.encode(`/blocks/${blockNumber}`),
      reference.toUint8Array(),
      { "Content-Type": "application/json", Filename: String(blockNumber) },
    );
    await saveManifest();

    const url = `${BZZ_LIMO}/bzz/${manifestReference}/blocks/${blockNumber}`;
    console.log(`[Swarm] Block ${blockNumber} archived: ${url}`);
    return url;
  } catch (err) {
    console.error(`[Swarm] Failed to publish block ${blockNumber}:`, err);
    return null;
  }
}

export function getBlockUrl(blockNumber: number): string | null {
  if (!manifestReference) return null;
  return `${BZZ_LIMO}/bzz/${manifestReference}/blocks/${blockNumber}`;
}

export function getAlertUrl(alertId: string): string | null {
  if (!manifestReference) return null;
  return `${BZZ_LIMO}/bzz/${manifestReference}/alerts/${alertId}`;
}

export function getManifestUrl(): string | null {
  if (!manifestReference) return null;
  return `${BZZ_LIMO}/bzz/${manifestReference}/`;
}
