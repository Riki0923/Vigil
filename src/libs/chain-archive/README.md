# chain-archive

A TypeScript library that stores Ethereum chain data on Swarm and exposes a stable, content-addressed retrieval interface. The library wraps a Swarm Mantaray manifest indexed by block number, owned by a single keypair, and supports get/put/list operations over arbitrary JSON-serializable payloads.

## Background

Ethereum's historical data is increasingly difficult to access. Archive nodes require terabytes of storage, and most applications fall back to centralized providers for old blocks, receipts, and state proofs. Swarm is content-addressed, signed-feed-backed storage, a natural fit for data that does not change once produced. This library implements a single-feed, single-manifest archive primitive: one keypair-owned manifest with `blocks/<n>` paths, content-addressed payloads, and signed updates.

## Installation

The library lives at `src/libs/chain-archive` in the [Vigil](https://github.com/Riki0923/Vigil) repository. Reference it from a TypeScript project:

```ts
import { ChainArchive } from "./libs/chain-archive/index.js";
```

Runtime dependency: [`@ethersphere/bee-js`](https://github.com/ethersphere/bee-js) ≥ 12.

## Usage

```ts
import { Bee, PrivateKey } from "@ethersphere/bee-js";
import { ChainArchive } from "./libs/chain-archive/index.js";

const archive = new ChainArchive({
  bee: new Bee("https://bzz.limo"),
  privateKey: new PrivateKey(Buffer.from(process.env.SWARM_PRIVATE_KEY!, "hex")),
  // Optional:
  // topic: Topic.fromString("eth-mainnet-blocks"),
  // postageStamp: NULL_STAMP,
  // gatewayUrl: "https://bzz.limo",
});

await archive.init();

await archive.archiveBlock(45_743_547, {
  number: 45_743_547,
  hash: "0xddedac…",
  transactions: [/* … */],
});

const block = await archive.getBlock(45_743_547);
console.log(archive.getFeedUrl());
console.log(archive.listBlocks());
```

## API Reference

### Constructor

```ts
new ChainArchive(options: ChainArchiveOptions)
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `bee` | `Bee` | required | Bee client. `new Bee("https://bzz.limo")` for the public gateway, or a self-hosted Bee node URL. |
| `privateKey` | `PrivateKey` | required | Owner keypair. Determines the feed address and signs every update. |
| `topic` | `Topic` | `Topic.fromString("chain-archive")` | Feed topic. Override to maintain multiple archives under the same key (e.g. one per chain). |
| `postageStamp` | `BatchId` | `NULL_STAMP` | The public `bzz.limo` gateway accepts `NULL_STAMP`; self-hosted nodes require a funded postage batch. |
| `gatewayUrl` | `string` | `"https://bzz.limo"` | URL prefix used by `getBlockUrl` and `getFeedUrl`. Does not affect publish behavior. |

### Methods

#### `init(): Promise<void>`

Initializes the archive: derives the permanent feed-manifest URL and attempts to load any prior manifest from the feed. Must be called once before any other method.

#### `archiveBlock(blockNumber: number, payload: BlockPayload): Promise<ArchiveResult>`

Uploads `payload` as a content-addressed chunk, appends it to the manifest at `blocks/<blockNumber>`, persists the updated manifest, and updates the feed.

**Returns:**

```ts
type ArchiveResult = {
  blockNumber: number;
  reference: string; // 32-byte hex chunk address (content-addressed)
  url: string;       // bzz.limo deep link to the payload
};
```

#### `getBlock(blockNumber: number): Promise<BlockPayload | null>`

Fetches the payload archived under `blocks/<blockNumber>`. Returns `null` when the block is not present in the in-memory manifest. Does not re-load the manifest from the feed; call `init()` to refresh.

#### `getBlockUrl(blockNumber: number): string | null`

Returns the deep-link URL for an archived block, or `null` if the block is not in the manifest. Does not fetch.

#### `listBlocks(): number[]`

Returns every block number currently archived in the manifest, sorted ascending.

#### `getFeedUrl(): string | null`

Returns the permanent subscriber-facing URL. The URL is deterministic in `(privateKey, topic)` and stable across restarts.

#### `getManifestReference(): string | null`

Returns the current root manifest reference as a hex string. The reference advances on every successful `archiveBlock` call.

## Independent Verifiability

Every payload is uploaded as a content-addressed Swarm chunk. The reference returned by `archiveBlock` is the keccak-derived chunk address. A subscriber may:

1. Fetch the payload from any Swarm gateway.
2. Recompute the chunk address from the received bytes per the Swarm BMT specification.
3. Compare the recomputed address to the reference advertised in the feed.

A failed comparison indicates tampering by the gateway. Feed updates are signed by the owner key, so the chain from the owner's Ethereum address through the manifest reference to a specific block payload is end-to-end verifiable.

The recomputation step is intentionally out of scope for this library; it is the responsibility of a separate verified-fetch implementation. See [helia-verified-fetch](https://github.com/ipfs/helia-verified-fetch) for the IPFS equivalent.

## Backfill Utility

The Vigil repository includes a backfill CLI at [`scripts/chain-archive/backfill.ts`](../../../scripts/chain-archive/backfill.ts) that ingests a contiguous block range from any JSON-RPC endpoint:

```bash
BASE_MAINNET_RPC_URL=https://base-mainnet.g.alchemy.com/v2/KEY \
SWARM_PRIVATE_KEY=0x... \
tsx scripts/chain-archive/backfill.ts --from <n> --to <n> [--topic <name>]
```

The script skips block numbers already present in the manifest, making re-runs idempotent.

## Implementation Notes

- **One manifest per archive instance.** Multiple archives under the same private key require distinct topics. Sharding within a single manifest is not supported.
- **Reads operate on the in-memory manifest.** `init()` loads the manifest tree once; subsequent `getBlock` calls retrieve only the leaf chunk. Restart the process or call `init()` again to pick up writes from another instance.
- **Append-only.** The manifest grows monotonically; entries are never removed. Long-lived archives should be partitioned across multiple instances with disjoint block ranges.
- **Postage is pluggable.** `NULL_STAMP` works through `bzz.limo`; supply a funded `BatchId` to use a self-hosted Bee node.
- **Read-side verification is out of scope.** Pair this library with a verified-fetch implementation for end-to-end trust-minimized reads.

## License

Same as the parent repository.
