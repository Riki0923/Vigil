// Chain archive on Swarm, block-indexed Mantaray manifest behind a signed feed.
//
// Architecture:
//   - One Mantaray manifest, owned by a keypair, served via a feed under `topic`.
//   - Each archived block lives at path `blocks/<blockNumber>` inside the manifest.
//   - Every archive call uploads the payload as a content-addressed chunk, adds a
//     fork to the manifest, saves the manifest (producing a new root reference),
//     and updates the feed to point at the new root.
//   - Subscribers fetch `getFeedUrl()`, walk to `blocks/<n>`, get the payload.
//
// Independent verifiability: every payload reference returned by `archiveBlock`
// is the keccak-derived Swarm chunk address. A third-party verified-fetch
// implementation can recompute the chunk hash to confirm the data has not been
// tampered with by the gateway. The feed signature on each update covers the
// manifest reference, so the chain back to the owner key is end-to-end signed.

import { MantarayNode, NULL_STAMP, Topic } from "@ethersphere/bee-js";
import type { Bee } from "@ethersphere/bee-js";
import type {
  ArchiveResult,
  BlockPayload,
  ChainArchiveOptions,
} from "./types.js";

export type {
  ArchiveResult,
  BlockPayload,
  ChainArchiveOptions,
} from "./types.js";

const DEFAULT_TOPIC_NAME = "chain-archive";
const DEFAULT_GATEWAY_URL = "https://bzz.limo";

export class ChainArchive {
  private readonly bee: Bee;
  private readonly privateKey: ChainArchiveOptions["privateKey"];
  private readonly topic: Topic;
  private readonly postageStamp: ChainArchiveOptions["postageStamp"];
  private readonly gatewayUrl: string;

  private node: MantarayNode | null = null;
  private manifestReference: string | null = null;
  private feedManifestUrl: string | null = null;

  constructor(opts: ChainArchiveOptions) {
    this.bee = opts.bee;
    this.privateKey = opts.privateKey;
    this.topic = opts.topic ?? Topic.fromString(DEFAULT_TOPIC_NAME);
    this.postageStamp = opts.postageStamp ?? NULL_STAMP;
    this.gatewayUrl = (opts.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, "");
  }

  /**
   * Initialise the archive: derive the permanent feed-manifest URL, then
   * attempt to load any prior manifest from the feed. Safe to call once at
   * startup; idempotent against an already-initialised instance.
   */
  async init(): Promise<void> {
    const feedWriter = this.bee.makeFeedWriter(this.topic, this.privateKey);

    const feedManifest = await this.bee.createFeedManifest(
      this.postageStamp!,
      this.topic,
      feedWriter.owner,
    );
    this.feedManifestUrl = `${this.gatewayUrl}/bzz/${feedManifest.toHex()}/`;

    try {
      const { reference } = await feedWriter.downloadReference();
      const node = await MantarayNode.unmarshal(this.bee, reference);
      await node.loadRecursively(this.bee);
      this.node = node;
      this.manifestReference = reference.toHex();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const message = (err as Error)?.message ?? "";
      if (status === 404 || message.includes("404")) {
        this.node = new MantarayNode();
      } else {
        // Unexpected failure, start fresh but propagate the warning to the
        // caller so they can decide whether to log/retry.
        this.node = new MantarayNode();
        throw err;
      }
    }
  }

  /**
   * Archive a payload under `blocks/<blockNumber>`. Uploads the payload,
   * appends to the manifest, saves the manifest, and updates the feed.
   * Returns the payload reference, deep-link URL, and block number.
   */
  async archiveBlock(
    blockNumber: number,
    payload: BlockPayload,
  ): Promise<ArchiveResult> {
    if (!this.node) {
      throw new Error("ChainArchive not initialised, call init() first");
    }
    if (!Number.isInteger(blockNumber) || blockNumber < 0) {
      throw new Error(`Invalid block number: ${blockNumber}`);
    }

    const json = JSON.stringify(payload);
    const upload = await this.bee.uploadData(this.postageStamp!, json);

    this.node.addFork(`blocks/${blockNumber}`, upload.reference, {
      "Content-Type": "application/json",
      Filename: String(blockNumber),
    });

    const saveResult = await this.node.saveRecursively(this.bee, this.postageStamp!);
    this.manifestReference = saveResult.reference.toHex();

    const feedWriter = this.bee.makeFeedWriter(this.topic, this.privateKey);
    await feedWriter.uploadReference(this.postageStamp!, saveResult.reference);

    return {
      blockNumber,
      reference: upload.reference.toHex(),
      url: `${this.gatewayUrl}/bzz/${this.manifestReference}/blocks/${blockNumber}`,
    };
  }

  /**
   * Fetch the payload archived under `blocks/<blockNumber>`. Returns null if
   * the block has not been archived. Walks the in-memory manifest by path,
   * resolves the chunk reference, and downloads from the gateway.
   */
  async getBlock(blockNumber: number): Promise<BlockPayload | null> {
    if (!this.node) {
      throw new Error("ChainArchive not initialised, call init() first");
    }

    const ref = this.findFork(`blocks/${blockNumber}`);
    if (!ref) return null;

    const data = await this.bee.downloadData(ref);
    return JSON.parse(data.toUtf8()) as BlockPayload;
  }

  /**
   * Returns the deep-link URL for an archived block, or null if not archived.
   * Does not fetch, purely a URL builder over the in-memory manifest state.
   */
  getBlockUrl(blockNumber: number): string | null {
    if (!this.manifestReference || !this.node) return null;
    if (!this.findFork(`blocks/${blockNumber}`)) return null;
    return `${this.gatewayUrl}/bzz/${this.manifestReference}/blocks/${blockNumber}`;
  }

  /**
   * Returns every block number currently archived in this manifest.
   * Sorted ascending. Useful for `--from <n> --to <n>` backfill checks.
   */
  listBlocks(): number[] {
    if (!this.node) return [];
    const numbers: number[] = [];
    for (const entry of this.node.collect()) {
      const m = /^blocks\/(\d+)$/.exec(entry.fullPathString);
      if (m && m[1]) numbers.push(parseInt(m[1], 10));
    }
    return numbers.sort((a, b) => a - b);
  }

  /**
   * Permanent subscriber-facing URL for this archive. Resolves to the
   * latest manifest root and stays the same across restarts as long as
   * the same private key + topic are reused.
   */
  getFeedUrl(): string | null {
    return this.feedManifestUrl;
  }

  /** Latest manifest root reference (hex). Updates on every archiveBlock. */
  getManifestReference(): string | null {
    return this.manifestReference;
  }

  // Walks the manifest forks to find a leaf at `path`. Returns the
  // target chunk reference (Uint8Array) bee-js can pass to downloadData.
  private findFork(path: string): Uint8Array | null {
    if (!this.node) return null;
    for (const entry of this.node.collect()) {
      if (entry.fullPathString === path) {
        return entry.targetAddress;
      }
    }
    return null;
  }
}
