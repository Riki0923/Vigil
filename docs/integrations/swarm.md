# Swarm Integration

Vigil persists upgrade alerts and their originating block payloads to Swarm, a content-addressed peer-to-peer storage network. Subscribers read alerts trustlessly through any public Swarm gateway, with no dependency on Vigil-controlled infrastructure.

## Overview

The integration uses three Swarm primitives:

- **Bytes uploads.** Each payload is uploaded as a content-addressed chunk; the returned reference is the keccak-derived address of the data.
- **Mantaray manifests.** A tree-structured directory primitive. Vigil maintains a single manifest indexed by Ethereum block number, with entries at `blocks/<n>`.
- **Feeds.** A signed, mutable pointer owned by an Ethereum keypair. The manifest reference is published as a feed update, so subscribers fetching `(owner, topic)` always retrieve the current manifest.

Uploads are sent to the public `bzz.limo` gateway using `NULL_STAMP`. Self-hosted Bee deployments are supported through configuration of the underlying [`ChainArchive`](../../src/libs/chain-archive/README.md) library.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                          Vigil Agent                             │
│                                                                  │
│   src/swarm/index.ts                                             │
│   ├── initSwarm()                                                │
│   │   ├── load SWARM_PRIVATE_KEY (or generate)                   │
│   │   ├── construct ChainArchive(topic = "vigil-manifest")       │
│   │   └── rehydrate manifest from feed if present                │
│   │                                                              │
│   ├── publishData(alert, block)                                  │
│   │   ├── upload {alert, block} as JSON                          │
│   │   ├── append to manifest at blocks/<n>                       │
│   │   └── update signed feed                                     │
│   │                                                              │
│   └── getFeedUrl()                                               │
│       └── permanent subscriber URL                               │
└──────────────────────────────────────────────────────────────────┘
                                 │
                                 │  HTTPS · NULL_STAMP
                                 ▼
                  ┌──────────────────────────────────────────────┐
                  │       bzz.limo  (public Swarm gateway)       │
                  │                                              │
                  │   POST /bytes               → reference      │
                  │   POST /feeds/{o}/{t}       → reference      │
                  │   GET  /feeds/{o}/{t}       ← latest         │
                  │                              manifest        │
                  │   GET  /bzz/{ref}/<path>    ← manifest entry │
                  └──────────────────────────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────────────┐
              │                  Subscribers                     │
              │                                                  │
              │   1. resolve agent.vigil.eth                     │
              │   2. read text record `vigil.feed`               │
              │   3. GET <feed URL> → current manifest reference │
              │   4. GET <reference>/blocks/<n> for each block   │
              └──────────────────────────────────────────────────┘
```

### Storage model

Each detected upgrade produces one manifest entry:

| Path | Producer | Content-Type | Payload |
| --- | --- | --- | --- |
| `blocks/<blockNumber>` | `publishData` | `application/json` | `{ alert, block }` envelope |

The manifest is append-only. Entries are never removed by the agent.

### Feed URL derivation

The subscriber-facing URL is deterministic:

```text
https://bzz.limo/feeds/<ownerAddress>/<topicHex>
```

- `ownerAddress` is the Ethereum address derived from `SWARM_PRIVATE_KEY`.
- `topicHex` is `keccak256("vigil-manifest")`.

The URL is stable across agent restarts as long as `SWARM_PRIVATE_KEY` is unchanged.

### Postage stamps

Uploads through the public gateway accept `NULL_STAMP`; the gateway sponsors postage. Self-hosted Bee deployments require a funded postage batch supplied via the `postageStamp` option on the `ChainArchive` constructor.

## Configuration

### Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SWARM_PRIVATE_KEY` | Recommended | generated per restart | 32-byte hex private key. Determines the feed owner address and signs every update. When unset, a key is generated and printed on startup; pin the printed value to keep the feed URL stable across restarts. |

The gateway URL (`https://bzz.limo`) and manifest topic (`vigil-manifest`) are pinned in source code as deployment invariants. Subscribers rely on these values; do not change them in production.

## API Reference

The Vigil-specific wrapper resides in [`src/swarm/index.ts`](../../src/swarm/index.ts). It is a thin adapter over the [`ChainArchive`](../../src/libs/chain-archive/README.md) library.

### `initSwarm(): Promise<void>`

Initializes the Swarm client. Loads `SWARM_PRIVATE_KEY` (or generates one), instantiates a `ChainArchive` pinned to the `vigil-manifest` topic, and rehydrates any previously published manifest from the feed.

**Behavior:**

- On success, logs the permanent feed URL and the count of restored entries.
- On rehydration failure, logs a warning and starts with an empty manifest.

Must be awaited before any call to `publishData`.

### `publishData(alert: Alert, block: ethers.Block): Promise<string | null>`

Uploads an `{ alert, block }` envelope and indexes it under `blocks/<block.number>` in the manifest.

| Parameter | Type | Description |
| --- | --- | --- |
| `alert` | `Alert` | Alert payload constructed by [`src/alerts/index.ts`](../../src/alerts/index.ts). |
| `block` | `ethers.Block` | Originating Ethereum block. Must expose `.number`. |

**Returns:** the deep-link URL of the uploaded payload, or `null` on failure. Failures are logged; the function does not throw.

### `getFeedUrl(): string | null`

Returns the permanent subscriber-facing URL, or `null` if `initSwarm` has not run.

## Operational Scripts

### `tsx scripts/swarm/seed-feed.ts`

Publishes a single bootstrap entry (severity `INFO`, kind `bootstrap`) so the feed URL returns parseable JSON before the first real upgrade is detected. Useful after pinning a new `SWARM_PRIVATE_KEY` or rotating the keypair. Safe to re-run; each invocation appends a fresh bootstrap entry.

## Failure Modes

| Condition | Effect | Remediation |
| --- | --- | --- |
| `bzz.limo` unreachable | `publishData` returns `null`. Alerts persist only to the local JSON store. The agent does not crash. | Retries on the next upgrade. For sustained failures, deploy a self-hosted Bee node and pass it via the `ChainArchive` constructor. |
| `SWARM_PRIVATE_KEY` rotated without ENS update | The `vigil.feed` text record on `agent.vigil.eth` points to the previous feed URL; subscribers read from the wrong feed. | Run `npm run ens:sync-feed`. |
| Postage policy change at the gateway | `NULL_STAMP` uploads begin failing with a non-2xx response. | Supply a funded postage batch via the `ChainArchive` `postageStamp` option and switch to a self-hosted or third-party Bee node. |

## Chain Archive Library

The block-archive primitive is implemented as a standalone library at [`src/libs/chain-archive`](../../src/libs/chain-archive). The Vigil-specific wrapper is one consumer; the library itself has no Vigil dependencies and may be used by any application that needs to archive block-indexed payloads on Swarm.

### Usage

```ts
import { Bee, PrivateKey, Topic } from "@ethersphere/bee-js";
import { ChainArchive } from "./libs/chain-archive/index.js";

const archive = new ChainArchive({
  bee: new Bee("https://bzz.limo"),
  privateKey: new PrivateKey(Buffer.from(process.env.SWARM_PRIVATE_KEY!, "hex")),
  // optional:
  // topic: Topic.fromString("eth-mainnet-blocks"),
  // postageStamp: NULL_STAMP,
  // gatewayUrl: "https://bzz.limo",
});

await archive.init();
await archive.archiveBlock(45_780_850, blockJson);
const block = await archive.getBlock(45_780_850);
const feedUrl = archive.getFeedUrl();
const archived = archive.listBlocks();
```

Full reference: [`src/libs/chain-archive/README.md`](../../src/libs/chain-archive/README.md).

### Backfill utility

[`scripts/chain-archive/backfill.ts`](../../scripts/chain-archive/backfill.ts), wired as `npm run archive:backfill`:

```bash
SWARM_PRIVATE_KEY=<hex> \
BASE_MAINNET_RPC_URL=<json-rpc-url> \
npm run archive:backfill -- --from <n> --to <n> [--topic <name>]
```

The script ingests each block from the configured RPC and archives it via `ChainArchive`. Block numbers already present in the manifest are skipped.

### Independent verifiability

References returned by the library are content-addressed Swarm chunk hashes. A subscriber may:

1. Fetch the payload from any Swarm gateway.
2. Recompute the chunk address from the received bytes per the Swarm BMT specification.
3. Compare the recomputed address to the reference returned by `archiveBlock`.

A failed comparison indicates tampering by the gateway. Recomputation is intentionally out of scope for this library; it is the responsibility of a separate verified-fetch implementation. See [helia-verified-fetch](https://github.com/ipfs/helia-verified-fetch) for the IPFS equivalent.

## Verification

The integration can be verified end-to-end without a Swarm SDK:

```bash
# Resolve the agent's feed URL through ENS
npm run ens:resolve agent.vigil.eth

# Confirm the feed responds
curl -sIL '<vigil.feed URL>'

# Read a block payload from the manifest
curl -s '<vigil.feed URL>blocks/<n>' | jq .

# Populate the feed with a bootstrap entry if it is empty
tsx scripts/swarm/seed-feed.ts
```

## References

- [Bee API](https://docs.ethswarm.org/api/) — gateway upload and download endpoints.
- [bee-js SDK](https://github.com/ethersphere/bee-js) — TypeScript client used by the integration.
- [Swarm Feeds](https://docs.ethswarm.org/docs/develop/access-the-swarm/feeds) — feed semantics and wire format.
- [Mantaray manifest specification](https://docs.ethswarm.org/docs/concepts/manifest) — directory primitive.
- [helia-verified-fetch](https://github.com/ipfs/helia-verified-fetch) — IPFS verified-fetch reference implementation.
