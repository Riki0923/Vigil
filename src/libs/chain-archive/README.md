# chain-archive

A small TypeScript library that stores Ethereum chain data on Swarm and lets anyone retrieve it without trusting a centralized provider.

The library wraps a Swarm Mantaray manifest indexed by block number, owned by a single keypair, and exposes get/put/list operations. Payloads are arbitrary JSON — raw blocks, enriched alert envelopes, light-client snapshots, anything you want indexed by block height.

## Why

Ethereum's historical data is getting harder to access. Archive nodes take terabytes; most developers depend on centralized providers for old blocks, receipts, and state proofs. Swarm is content-addressed, signed-feed-backed storage that's a natural fit for data that never changes — store once, retrieve trustlessly forever.

This library is the smallest credible building block for that pattern: one feed, one manifest, `blocks/<n>` paths, content-addressed payloads, owner-signed updates.

## Install

The library lives in `src/libs/chain-archive` of the [Vigil](https://github.com/Riki0923/Vigil) repo. Pull the directory or reference it directly from your TypeScript project:

```ts
import { ChainArchive } from "./libs/chain-archive/index.js";
```

Runtime dependency: [`@ethersphere/bee-js`](https://github.com/ethersphere/bee-js) ≥12.

## Quick start

```ts
import { Bee, PrivateKey } from "@ethersphere/bee-js";
import { ChainArchive } from "./libs/chain-archive/index.js";

const archive = new ChainArchive({
  bee: new Bee("https://bzz.limo"),
  privateKey: new PrivateKey(Buffer.from(process.env.SWARM_PRIVATE_KEY!, "hex")),
  // optional:
  // topic: Topic.fromString("eth-mainnet-blocks"),
  // postageStamp: NULL_STAMP,            // bzz.limo sponsors postage
  // gatewayUrl: "https://bzz.limo",
});

await archive.init();   // load existing manifest if any, else start fresh

// Archive a block
await archive.archiveBlock(45_743_547, {
  number: 45_743_547,
  hash: "0xddedac…",
  transactions: [/* … */],
});

// Read it back
const block = await archive.getBlock(45_743_547);

// Subscriber URL — stable across restarts as long as the same key is used
console.log("Feed URL:", archive.getFeedUrl());

// Inventory of what's in the archive right now
console.log("Archived blocks:", archive.listBlocks());
```

## API

### `new ChainArchive(opts)`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `bee` | `Bee` | required | `new Bee(gatewayUrl)` for public gateway, or your own Bee node URL |
| `privateKey` | `PrivateKey` | required | Owner key. Determines the feed address and signs every update. |
| `topic` | `Topic` | `Topic.fromString("chain-archive")` | Override to keep multiple archives under one key |
| `postageStamp` | `BatchId` | `NULL_STAMP` | The public bzz.limo gateway accepts NULL_STAMP; self-hosted nodes need a funded batch |
| `gatewayUrl` | `string` | `"https://bzz.limo"` | URL prefix for built links — read-only, doesn't change publish behavior |

### Methods

- `init()` — load any prior manifest from the feed, or start fresh. Always call once before other methods.
- `archiveBlock(n, payload)` — upload payload, append to manifest, update feed. Returns `{ blockNumber, reference, url }`.
- `getBlock(n)` — fetch the payload archived under `blocks/<n>`. Returns `null` if not present.
- `getBlockUrl(n)` — deep-link URL for the block. Returns `null` if not archived. Does not fetch.
- `listBlocks()` — sorted array of every block number currently in the manifest.
- `getFeedUrl()` — subscriber-facing URL. Stable across restarts when key + topic are reused.
- `getManifestReference()` — current root manifest reference (changes on every archive).

## Independent verifiability

Every payload is uploaded as a content-addressed Swarm chunk. The reference returned by `archiveBlock` *is* the keccak-derived chunk address. A subscriber can:

1. Fetch the payload from any Swarm gateway.
2. Recompute the chunk address from the bytes.
3. Compare to the reference advertised in the feed.

Tampering by the gateway breaks the comparison. The feed updates themselves are signed by the owner key, so the chain from the owner's address all the way down to a specific block payload is end-to-end verifiable.

The recomputation step is intentionally out of scope for this library — pair it with a dedicated verified-fetch implementation when one is available, or use [helia-verified-fetch](https://github.com/ipfs/helia-verified-fetch) as a structural reference for the read+verify primitive.

## Backfilling a range from an RPC

The repo ships [`scripts/chain-archive/backfill.ts`](../../../scripts/chain-archive/backfill.ts), a small CLI that pulls a block range from any JSON-RPC endpoint and archives each block:

```bash
RPC_URL=https://base-sepolia.g.alchemy.com/v2/KEY \
SWARM_PRIVATE_KEY=0x... \
tsx scripts/chain-archive/backfill.ts --from 41250000 --to 41250100
```

A few hundred blocks fits comfortably under the public gateway's NULL_STAMP allowance and constitutes a credible Block Archive proof-of-concept.

## Design notes

- **One Mantaray manifest per archive instance.** Multiple archives under the same key require different topics. The library does not split a single manifest into shards.
- **Reads are fork-walks of the in-memory manifest.** `init()` loads the full manifest tree once; subsequent `getBlock` calls don't re-fetch the manifest — only the leaf chunk. Restart the process or call `init()` again to refresh.
- **No pruning.** A manifest grows monotonically. For long-lived archives, run multiple instances with disjoint block ranges (e.g. one per epoch) and link them externally.
- **Postage stamps are pluggable.** The default `NULL_STAMP` works behind `bzz.limo`; flip to a real batch when you operate your own Bee.
- **No verification on the read side.** This library archives and serves; verifying the bytes received from a gateway is a separate concern handled by a verified-fetch implementation.

## License

Same as the parent repository.
