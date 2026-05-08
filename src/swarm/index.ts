import { Bee, Topic, PrivateKey } from "@ethersphere/bee-js";
import { randomBytes } from "crypto";

const SWARM_BEE_URL = process.env.SWARM_BEE_URL ?? "https://bee-api.ethswarm.org";
const ALERT_TOPIC_NAME = "vigil-alerts";

let bee: Bee;
let privateKey: PrivateKey;
let alertTopic: Topic;
let ownerAddress: string;

export function initSwarm(): void {
  bee = new Bee(SWARM_BEE_URL);

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

  alertTopic = Topic.fromString(ALERT_TOPIC_NAME);
  ownerAddress = privateKey.publicKey().address().toChecksum();

  console.log(`[Swarm] Owner address: ${ownerAddress}`);
  console.log(`[Swarm] Alert feed topic: ${ALERT_TOPIC_NAME} (${alertTopic.toHex()})`);
  console.log(`[Swarm] Bee node: ${SWARM_BEE_URL}`);
}

function checkPostageStamp(): string | null {
  const stamp = process.env.SWARM_POSTAGE_STAMP;
  if (!stamp) {
    console.warn(`[Swarm] Warning: SWARM_POSTAGE_STAMP is not set — cannot publish to Swarm`);
    return null;
  }
  return stamp;
}

export async function publishAlert(alert: unknown, batchId: string): Promise<string | null> {
  if (!bee || !privateKey) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  try {
    const json = JSON.stringify(alert);
    const uploadResult = await bee.uploadData(batchId, Buffer.from(json));
    const ref = uploadResult.reference;

    const writer = bee.makeFeedWriter(alertTopic, privateKey);
    await writer.upload(batchId, ref);

    const hash = ref.toHex();
    console.log(`[Swarm] Alert published: ${hash}`);
    return hash;
  } catch (err) {
    console.error(`[Swarm] Failed to publish alert:`, err);
    return null;
  }
}

export async function publishBlock(
  blockData: unknown,
  blockNumber: number,
  batchId: string
): Promise<string | null> {
  if (!bee || !privateKey) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  try {
    const json = JSON.stringify(blockData);
    const uploadResult = await bee.uploadData(batchId, Buffer.from(json));
    const ref = uploadResult.reference;

    const blockTopic = Topic.fromString(`vigil-blocks-${blockNumber}`);
    const writer = bee.makeFeedWriter(blockTopic, privateKey);
    await writer.upload(batchId, ref);

    const hash = ref.toHex();
    console.log(`[Swarm] Block ${blockNumber} archived: ${hash}`);
    return hash;
  } catch (err) {
    console.error(`[Swarm] Failed to publish block ${blockNumber}:`, err);
    return null;
  }
}

export async function getAlertFeedManifest(): Promise<string | null> {
  if (!bee || !privateKey) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  const batchId = checkPostageStamp();
  if (!batchId) return null;

  try {
    const owner = privateKey.publicKey().address();
    const manifest = await bee.createFeedManifest(batchId, alertTopic, owner);
    const hash = manifest.toHex();
    console.log(`[Swarm] Alert feed manifest (permanent public address): ${hash}`);
    return hash;
  } catch (err) {
    console.error(`[Swarm] Failed to create feed manifest:`, err);
    return null;
  }
}
