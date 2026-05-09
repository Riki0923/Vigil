import { Bee, Topic, PrivateKey, NULL_STAMP, SWARM_GATEWAY_URL } from "@ethersphere/bee-js";
import { randomBytes } from "crypto";

const ALERT_TOPIC_NAME = "vigil-alerts";

let bee: Bee;
let privateKey: PrivateKey;
let alertTopic: Topic;
let ownerAddress: string;

export function initSwarm(): void {
  bee = new Bee(SWARM_GATEWAY_URL);

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
  console.log(`[Swarm] Gateway: ${SWARM_GATEWAY_URL}`);
}

export async function publishAlert(alert: any): Promise<string | null> {
  if (!bee || !privateKey) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  try {
    const json = JSON.stringify(alert);
    const uploadResult = await bee.uploadData(NULL_STAMP, Buffer.from(json));
    const reference = uploadResult.reference;

    const writer = bee.makeFeedWriter(alertTopic, privateKey);
    await writer.uploadReference(NULL_STAMP, reference);

    const url = `${SWARM_GATEWAY_URL}/bzz/${reference.toHex()}`;
    console.log(`[Swarm] Alert published: ${url}`);
    return url;
  } catch (err) {
    console.error(`[Swarm] Failed to publish alert:`, err);
    return null;
  }
}

export async function publishBlock(blockData: any, blockNumber: number): Promise<string | null> {
  if (!bee || !privateKey) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  try {
    const json = JSON.stringify(blockData);
    const uploadResult = await bee.uploadData(NULL_STAMP, Buffer.from(json));
    const reference = uploadResult.reference;

    const blockTopic = Topic.fromString(`vigil-blocks-${blockNumber}`);
    const writer = bee.makeFeedWriter(blockTopic, privateKey);
    await writer.uploadReference(NULL_STAMP, reference);

    const url = `${SWARM_GATEWAY_URL}/bzz/${reference.toHex()}`;
    console.log(`[Swarm] Block ${blockNumber} archived: ${url}`);
    return url;
  } catch (err) {
    console.error(`[Swarm] Failed to publish block ${blockNumber}:`, err);
    return null;
  }
}

export function getFeedManifestUrl(): string | null {
  if (!alertTopic || !ownerAddress) {
    console.warn(`[Swarm] Not initialised — call initSwarm() first`);
    return null;
  }

  return `${SWARM_GATEWAY_URL}/feeds/${ownerAddress}/${alertTopic.toHex()}`;
}
