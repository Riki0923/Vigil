// Public types for the chain-archive library.
//
// The library wraps a Swarm Mantaray manifest indexed by block number, owned
// by a single keypair, and exposes get/put/list operations. Consumers can
// archive arbitrary JSON-serializable payloads under each block number.

import type { Bee, BatchId, PrivateKey, Topic } from "@ethersphere/bee-js";

export interface ChainArchiveOptions {
  /**
   * Bee client. Use `new Bee("https://bzz.limo")` for the public gateway,
   * or pass a Bee node URL for self-hosted operation.
   */
  bee: Bee;

  /**
   * Owner keypair. Determines the feed address and signs every update.
   * The same key + topic produces the same subscriber URL across restarts.
   */
  privateKey: PrivateKey;

  /**
   * Feed topic. Defaults to keccak256("chain-archive").
   * Override to keep multiple archives under the same key (e.g. one per chain).
   */
  topic?: Topic;

  /**
   * Postage batch id. Defaults to `NULL_STAMP` so the public bzz.limo gateway
   * sponsors the postage. For self-hosted Bee nodes, supply a funded batch.
   */
  postageStamp?: BatchId;

  /**
   * URL prefix used for building deep links returned by `getBlockUrl` and
   * `getFeedUrl`. Defaults to `https://bzz.limo`.
   */
  gatewayUrl?: string;
}

export interface ArchiveResult {
  blockNumber: number;
  /** Swarm reference (32-byte hex) of the uploaded payload — content-addressed. */
  reference: string;
  /** Deep-link URL fetchable from any Swarm gateway. */
  url: string;
}

/** Any JSON-serializable value. The library does not interpret the payload. */
export type BlockPayload = unknown;
