# How Swarm is used in Vigil

Read the **plain English** section first. Technical detail and diagrams below.

> **Note (2026-05-09):** the publishing path was simplified after this doc was written. The current agent uses a single `publishData(alert, block)` call that writes one combined `{alert, block}` entry under `blocks/<n>` in the manifest — there is no longer a separate `alerts/<id>` path. The boot-time `vigil.feed` invariant check has also been removed. Older sections below describe the previous architecture and are kept for reference; the **Chain Archive — Standalone Library** section at the bottom reflects the current shape.

---

## In plain English (start here)

### What is Swarm?

Swarm is a peer-to-peer storage network — content-addressed, censorship-resistant, with cryptographic ownership baked into the protocol. Two primitives matter for Vigil:

- **Bytes uploads** — push a blob, get back a Swarm reference (content hash). Anyone with the reference can fetch the blob via any gateway.
- **Feeds** — a signed, mutable pointer owned by a keypair. The owner publishes successive references under a topic; anyone with `(owner, topic)` can fetch the latest. The protocol guarantees only the keyholder can update a feed, so subscribers don't need to trust the gateway.

`bzz.limo` is the public Swarm gateway. Hitting it with a feed URL like `https://bzz.limo/feeds/<owner>/<topic>` returns whatever the owner most recently published under that topic — no API key, no auth.

### Why Swarm matters for Vigil

The agent watches proxy upgrades on Base and produces alerts. Subscribers (other agents, dashboards, monitoring services) need to read those alerts without trusting Vigil's own infrastructure. The hard requirements:

1. **No central server.** A subscriber should not have to hit a Vigil-controlled API endpoint that could go offline, get rate-limited, or be censored.
2. **Cryptographic ownership.** A subscriber should be able to verify that an alert came from the agent's keypair and was not tampered with by the gateway.
3. **Persistence across restarts.** When the agent process restarts, subscribers should keep seeing the same feed URL with new alerts appended — not a fresh URL every time.
4. **Discoverable from a name, not an IP.** Subscribers should resolve `agent.vigil.eth` and find the feed; key rotation should be a single record update.

Swarm's signed feeds satisfy (1)–(3); ENS handles (4) by carrying the feed URL as a text record on `agent.vigil.eth`. See [`ens.md`](ens.md) for the discovery side.

### The clever bit: one Mantaray manifest, many entries

A naive design would publish each alert as its own feed (`vigil-alerts-<id>`) or each block as its own feed. That fragments the namespace and forces subscribers to know about many topics.

Vigil instead maintains **one Mantaray manifest** — Swarm's tree-structured "filesystem" primitive — under a single feed topic (`vigil-manifest`). Every alert lands at `alerts/<uuid>` inside the manifest; every block payload at `blocks/<number>`. Subscribers fetch one URL, walk one tree, find everything. Pinning `SWARM_PRIVATE_KEY` in the agent's environment lets [`initSwarm`](../../src/swarm/index.ts) re-load the existing manifest at boot and keep appending — the URL stays stable across restarts.

This shape collapses three old problems (per-alert feed sprawl, block archive separately maintained, subscriber URL churn) into a single signed pointer. The pointer URL is computed deterministically from `(owner, topic)` and published on `agent.vigil.eth` so any subscriber can find it.

### Why `NULL_STAMP` and not a postage batch

Swarm payments are normally made via **postage stamps** — prepaid BZZ tokens that buy upload capacity. Operationally that means another asset to acquire, monitor, and refill.

The public `bzz.limo` gateway accepts `NULL_STAMP` for uploads — the gateway itself sponsors the postage. For an agent that publishes a few KB of alert JSON every time an upgrade lands (rare events), this is sufficient. The trade-off: upload availability is now coupled to the gateway's policy. If `bzz.limo` ever stops sponsoring `NULL_STAMP`, the agent needs a real postage batch and a Bee node — but that's a config flip in [`src/swarm/index.ts`](../../src/swarm/index.ts), not a redesign.

---

## Now the technical details

## The whole thing in one picture

```text
┌──────────────────────────────────────────────────────────────────┐
│                         VIGIL AGENT                              │
│                                                                  │
│   src/swarm/index.ts                                             │
│                                                                  │
│   initSwarm()                                                    │
│     ├─ loads SWARM_PRIVATE_KEY (or generates one and prints it)  │
│     ├─ topic = Topic.fromString("vigil-manifest")                │
│     └─ if key was provided, attempts to re-load existing manifest│
│        from the feed (subscriber URL stays stable)               │
│                                                                  │
│   publishAlert(alert)                                            │
│     ├─ uploadData(NULL_STAMP, JSON.stringify(alert))             │
│     ├─ manifest.addFork("alerts/<id>", reference, headers)       │
│     └─ saveManifest() → feedWriter.uploadReference(...)          │
│                                                                  │
│   publishBlock(blockData, blockNumber)                           │
│     ├─ uploadData(NULL_STAMP, JSON.stringify(blockData))         │
│     ├─ manifest.addFork("blocks/<n>", reference, headers)        │
│     └─ saveManifest()                                            │
│                                                                  │
│   getCurrentFeedUrl()                                            │
│     └─ deterministic: bzz.limo/feeds/<owner>/<topicHex>          │
└──────────────────────────────────────────────────────────────────┘
                                         │
                                         │  HTTPS, NULL_STAMP
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       bzz.limo  (public Swarm gateway)       │
                  │                                              │
                  │   POST /bytes              → reference       │
                  │   POST /feeds/{o}/{t}      → reference       │
                  │   GET  /feeds/{o}/{t}      ← latest manifest │
                  │   GET  /bzz/{ref}/<path>   ← any path inside │
                  └──────────────────────────────────────────────┘
                                         │
                                         ▼
              ┌───────────────────────────────────────────────────┐
              │   SUBSCRIBERS  (dashboards, agents, services)     │
              │                                                   │
              │   1. resolve agent.vigil.eth                      │
              │   2. read text record vigil.feed →  feed URL      │
              │   3. GET feed URL → latest manifest reference     │
              │   4. GET /bzz/<ref>/alerts/<id>  for each alert   │
              └───────────────────────────────────────────────────┘
```

**The pattern:** the agent owns a keypair, publishes signed updates to one topic, and exposes the deterministic read URL via ENS. No server, no API key, no central index.

## Topology — one feed, two namespaces

| Path inside the manifest | Producer | Content-Type |
| --- | --- | --- |
| `alerts/<uuid>` | `publishAlert()` after every upgrade alert | `application/json` |
| `blocks/<blockNumber>` | `publishBlock()` after every upgrade alert (the originating block payload, archived for reproducibility) | `application/json` |

A subscriber that wants only alerts walks the `alerts/` subtree. A subscriber doing forensics (replaying upgrades against a specific block) walks `blocks/`. The two namespaces are owned by the same keypair, signed under the same feed topic, served from the same manifest reference.

## How a publish actually flows

```text
publishAlert(alert)
  │
  ├─ bee.uploadData(NULL_STAMP, JSON.stringify(alert))
  │     → Swarm chunk + reference (32-byte content hash)
  │
  ├─ currentManifest.addFork(`alerts/${alert.id}`, reference, {
  │     "Content-Type": "application/json",
  │     "Filename":      alert.id,
  │   })
  │
  ├─ saveManifest():
  │     ├─ manifest.saveRecursively(bee, NULL_STAMP)
  │     │     → new manifest reference (every save is a fresh root)
  │     └─ feedWriter.uploadReference(NULL_STAMP, manifestReference)
  │           → publishes the new reference under the signed feed
  │
  └─ returns bzz.limo/bytes/<alertReference>   (single-blob URL)
```

A subscriber following the feed sees a new manifest reference; walking the manifest finds the new `alerts/<id>` path and the alert payload. The two-step (data upload → feed update) is intentional: the feed always points to the *root manifest*, not directly at the alert blob, so the same feed URL serves every alert ever published.

## The feed URL invariant

The agent's deterministic feed URL is:

```text
https://bzz.limo/feeds/<ownerAddress>/<topicHex>
```

`ownerAddress` is derived from `SWARM_PRIVATE_KEY`; `topicHex` is the keccak hex of the string `vigil-manifest`. Pin the key, the URL is stable forever.

The agent advertises this URL on `agent.vigil.eth` as the `vigil.feed` text record. On boot, [`bootEnsConfig`](../../src/agent/index.ts) reads the ENS record and [`verifyFeedUrlInvariant`](../../src/agent/index.ts) compares it to `getCurrentFeedUrl()`. Three outcomes:

| ENS state | Actual feed URL | Behavior |
| --- | --- | --- |
| match | match | One-line confirmation log; subscribers can discover this agent |
| unset | known | Loud warning — subscribers can't find the feed; suggests `npm run ens:sync-feed` |
| stale | different | Loud warning — points at the mismatch and suggests `npm run ens:sync-feed` |

The invariant decouples key rotation from subscriber pain: rotate the key, run one script, and every existing subscriber follows the new URL.

## Cheat sheet

| Function in [`src/swarm/index.ts`](../../src/swarm/index.ts) | What it does |
| --- | --- |
| `initSwarm()` | Loads the keypair, derives the topic, rehydrates the existing manifest if the key was pinned |
| `publishAlert(alert)` | Uploads JSON, appends `alerts/<id>` to the manifest, re-publishes the feed |
| `publishBlock(block, n)` | Uploads JSON, appends `blocks/<n>` to the manifest, re-publishes the feed |
| `getAlertUrl(id)` | Returns the deep-link URL `bzz.limo/bzz/<manifestRef>/alerts/<id>` |
| `getBlockUrl(n)` | Returns `bzz.limo/bzz/<manifestRef>/blocks/<n>` |
| `getManifestUrl()` | Returns `bzz.limo/bzz/<manifestRef>/` (manifest root) |
| `getCurrentFeedUrl()` | Returns the subscriber-facing feed URL (deterministic from key + topic) |

| Operational script | What it does |
| --- | --- |
| [`scripts/swarm/seed-feed.ts`](../../scripts/swarm/seed-feed.ts) | Publishes one bootstrap alert (severity `INFO`, kind `bootstrap`) so the feed URL returns parseable JSON before the first real upgrade lands |

## Why removing Swarm breaks the agent

```text
┌──────────────────────────────────────────────────────────────────┐
│  Swarm off       →   Visible damage                              │
├──────────────────────────────────────────────────────────────────┤
│  No publishAlert →   alerts only land in data/alerts.json on the │
│                      agent host — subscribers can't reach them   │
│                      without an out-of-band copy                 │
│                                                                  │
│  No feed URL     →   ENS vigil.feed becomes a 404 — discovery    │
│                      promise is broken                           │
│                                                                  │
│  No manifest     →   per-alert deep links (getAlertUrl) return   │
│                      null — no permanent reference for citation  │
│                                                                  │
│  No block        →   reproducibility loss — replaying an alert   │
│  archive             against the originating block needs an RPC  │
│                      that still has the block in scope           │
└──────────────────────────────────────────────────────────────────┘
```

The agent doesn't crash if Swarm is unreachable — `publishAlert` returns `null`, `emitAlert` continues to the local JSON store. But the subscriber-facing surface (the entire decentralized-distribution promise) goes away.

## Verify any of this in 30 seconds

```bash
# 1. Resolve the agent's feed URL via ENS (no Vigil API call)
npm run ens:resolve agent.vigil.eth   # → vigil.feed: https://bzz.limo/feeds/0x.../...

# 2. Hit the feed directly — returns the latest manifest reference
curl -sIL '<vigil.feed URL>' | head

# 3. Walk the manifest for a specific alert
curl -s 'https://bzz.limo/bzz/<manifestRef>/alerts/<uuid>' | jq .

# 4. Run the bootstrap script if the feed has nothing yet
tsx scripts/swarm/seed-feed.ts
```

Any browser can hit `bzz.limo` URLs directly — gateway access requires no client SDK.

## TL;DR

1. **Swarm is Vigil's distribution layer.** Alerts live in a content-addressed, signed feed that subscribers fetch through the public `bzz.limo` gateway.
2. **One Mantaray manifest, two paths.** `alerts/<id>` for every published alert, `blocks/<n>` for the originating block payload. Subscribers walk one tree.
3. **The feed URL is deterministic and stable.** Derived from `(owner, topic)`; pin `SWARM_PRIVATE_KEY` and the URL is forever. Rotation is a one-record ENS update via `npm run ens:sync-feed`.
4. **`NULL_STAMP` keeps ops simple.** No postage batch, no Bee node. The trade-off is gateway dependency; the design tolerates flipping to a real batch later.
5. **A boot-time invariant** verifies the ENS-published URL matches the actual publish URL — stale ENS records get flagged loudly, not silently.

---

## Chain Archive — standalone library

The block-archive half of Vigil's Swarm publishing has been extracted into a standalone TypeScript library at [`src/libs/chain-archive`](../../src/libs/chain-archive). It's the smallest credible building block for "Ethereum Chain State on Swarm" — own a keypair, archive payloads under a block-number-indexed Mantaray manifest, expose a stable subscriber URL through a signed feed.

### Why extract it

Vigil's `src/swarm/index.ts` previously inlined the Mantaray + feed bookkeeping alongside the `{alert, block}` payload shape Vigil cares about. Pulling the generic block-archive primitive into its own library gives:

- A reusable building block any project can drop in to archive arbitrary chain state on Swarm — not just Vigil's alert envelopes.
- A clean API surface that maps directly to the Block Archive bounty (Option A of "Ethereum Chain State on Swarm"): `archiveBlock(n, payload)`, `getBlock(n)`, `listBlocks()`, `getFeedUrl()`.
- Independent verifiability built in: `archiveBlock` returns the keccak-derived chunk reference of the payload, so a subscriber can fetch from any gateway and recompute the hash locally to confirm the data is intact. Pair with a verified-fetch implementation when one is available.

Vigil's Swarm module is now a ~60-line wrapper that owns the keypair plumbing and the `{alert, block}` envelope; it instantiates `ChainArchive` with the pinned `vigil-manifest` topic so its previously-published feed URL stays stable.

### API at a glance

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

await archive.init();                               // load existing manifest if any
await archive.archiveBlock(45_780_850, blockJson);  // upload + index + sign
const block = await archive.getBlock(45_780_850);   // fetch back
console.log(archive.getFeedUrl());                  // stable subscriber URL
console.log(archive.listBlocks());                  // sorted block numbers
```

Full reference + design notes: [`src/libs/chain-archive/README.md`](../../src/libs/chain-archive/README.md).

### Backfilling a range from any RPC

The repo ships [`scripts/chain-archive/backfill.ts`](../../scripts/chain-archive/backfill.ts), wired as `npm run archive:backfill`:

```bash
SWARM_PRIVATE_KEY=0x... \
RPC_URL=https://base-mainnet.g.alchemy.com/v2/KEY \
npm run archive:backfill -- --from 45780850 --to 45780853 --topic vigil-test-archive
```

The script pulls each block from the JSON-RPC, archives it, and skips block numbers already in the manifest. Output looks like:

```text
[backfill] Feed URL: https://bzz.limo/bzz/2fb95c1f.../
[backfill] 45780850 → d6195384fc6a…
[backfill] 45780851 → bed3fd8274b5…
[backfill] 45780852 → c04246240504…
[backfill] 45780853 → 31e4e3ae5965…
[backfill] Done. Archived 4 new block(s), skipped 0
```

Re-running with an overlapping range only archives the new blocks; the feed URL stays the same across runs because it's derived deterministically from `(owner, topic)`.

### Independent verifiability — what's there and what isn't

What's there today:

- Every payload is a content-addressed Swarm chunk. The reference returned by `archiveBlock` *is* the keccak-derived chunk address.
- Every feed update is signed by the owner key. A subscriber resolving the feed URL can verify the manifest reference came from the expected owner.
- The chain from owner address → manifest reference → block payload is end-to-end signed.

What's intentionally not in the library:

- Recomputing the chunk hash from the bytes received from a gateway (the BMT verification step). That's the substance of a separate verified-fetch primitive — `ChainArchive` exposes the reference so a future verified-fetch can wrap `getBlock` cleanly. See the [helia-verified-fetch](https://github.com/ipfs/helia-verified-fetch) approach as a structural reference.

### Verify in 30 seconds

```bash
# Backfill 4 blocks against any chain
npm run archive:backfill -- --from <n> --to <n+3> --topic test-archive

# Hit the feed URL printed at the end — returns the latest block in the manifest
curl -s '<feed URL>/blocks/<n>' | jq '{number, hash, txCount: (.transactions | length)}'
```

Worked example from the test that proved the lib end-to-end (Base mainnet, blocks 45780850–45780855):

```text
Feed URL:    https://bzz.limo/bzz/2fb95c1f2d4446d4ad008f603dfcec4c2b7741871d596eaac562158a65b6a9f2/
Block 45780850 → 149 txs, hash 0xfb906001…
Block 45780855 → 128 txs, hash 0x94fc4d69…
```
