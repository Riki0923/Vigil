# How Sourcify is used in Vigil

Read the **plain English** section first. Technical detail and diagrams below.

---

## In plain English (start here)

### What is Sourcify?

Sourcify is a public, decentralized service that holds **verified source code** for deployed smart contracts. When a developer publishes a contract, they (or a tool) upload the original Solidity source plus the compiler metadata; Sourcify recompiles it and confirms the on-chain bytecode matches. From then on, anyone can hand Sourcify an address and get back the source, the ABI, the storage layout, the NatSpec docs, and a "perfect / partial" match flag — without any API key.

Most projects use Sourcify for one job: pull source code so a UI can show it. Vigil uses it for five.

### Why Sourcify matters for Vigil

Vigil watches proxy upgrades. Every upgrade points the proxy at a brand-new implementation contract. The interesting question is never "did an upgrade happen?" (that's just an event) — it's **"did the new code change something dangerous?"**

To answer that, the agent needs the *structure* of both the old and new implementations:

1. **Storage layout** — what variables live in which slots. If the new contract moves a variable from slot 3 to slot 4, every existing read of that variable now reads someone else's data. Storage collisions are the most common way malicious upgrades drain funds.
2. **ABI** — what functions exist, what they take, what they return. Removing `withdraw` is suspicious; *adding* a `drain(address)` with no access control is worse.
3. **NatSpec** — the comments the developer wrote about each function. Useful context for the AI analyser when the change is subtle.

All four pieces (layout, ABI, NatSpec, plus the verification status itself) come from Sourcify. **Without Sourcify, the agent can detect that an upgrade happened but cannot judge whether it's dangerous.**

### Handling the "just deployed, not yet indexed" race

Sourcify usually indexes a contract within seconds of verification, but not always. A new implementation can land on chain a minute before its source appears in Sourcify. The agent treats that as a real case rather than a failure:

- **Retry the verification check** (3 attempts, 30 seconds apart) — handles the common case of a slow indexer.
- **If still unverified, run a bytecode similarity search** — Sourcify exposes `/v2/verify/similarity`, which compares the new bytecode against everything Sourcify already has. A 0.9+ score means the implementation is structurally a clone of a known contract; the alert says so explicitly.
- **If similarity finds nothing**, the alert fires anyway with `severity: CRITICAL` — "unverified implementation, no known relatives, treat with maximum suspicion."

That logic lives in [`src/agent/index.ts`](../../src/agent/index.ts) (the pipeline) and [`src/sourcify/index.ts`](../../src/sourcify/index.ts) (the API client).

---

## Now the technical details

## The whole thing in one picture

```text
┌──────────────────────────────────────────────────────────────────┐
│                        VIGIL AGENT (Node.js)                     │
│                                                                  │
│   1. EIP-1967 Upgraded(address) detected on chain                │
│   2. Resolve newImpl + oldImpl from storage slot                 │
│                                                                  │
│             ▼                                                    │
│   ┌──────────────────────────────────────────────┐               │
│   │  src/sourcify/index.ts                       │               │
│   │                                              │   HTTPS        │
│   │  isVerifiedWithRetry(addr, 3, 30s) ──────────┼──────────┐    │
│   │                                              │          │    │
│   │  if !verified:                               │          │    │
│   │    findSimilarContracts(addr) ───────────────┼──────────┤    │
│   │                                              │          │    │
│   │  Promise.all([                               │          │    │
│   │    getStorageLayout(old), getStorageLayout(new),        │    │
│   │    getABI(old),           getABI(new),       │          │    │
│   │    getContractMeta(new),  getNatSpec(new),   │          │    │
│   │  ])                                          ├──────────┤    │
│   └──────────────────────────────────────────────┘          │    │
│             ▼                                               │    │
│   ┌──────────────────────────────────────────────┐          │    │
│   │  src/sourcify/diffStorage.ts                 │          │    │
│   │  diffStorageLayouts(old, new)                │          │    │
│   │    → moved / removed / added slots           │          │    │
│   │  assessRisk → AlertSeverity                  │          │    │
│   │                                              │          │    │
│   │  src/sourcify/diffFunctions.ts               │          │    │
│   │  diffABIs(old, new)                          │          │    │
│   │    → added / removed / modified functions    │          │    │
│   │  assessFunctionRisk → RiskFlag[]             │          │    │
│   └──────────────────────────────────────────────┘          │    │
│             ▼                                               │    │
│   ┌──────────────────────────────────────────────┐          │    │
│   │  src/agent/analyser.ts                       │          │    │
│   │  OpenAI gpt-4o ← (diffs + NatSpec)           │          │    │
│   │    → {summary, explanation, recommendation}  │          │    │
│   └──────────────────────────────────────────────┘          │    │
└──────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
                            ┌─────────────────────────────────────┐
                            │    sourcify.dev/server (public)     │
                            │                                     │
                            │  GET  /check-by-addresses           │
                            │  GET  /v2/contract/{chain}/{addr}   │
                            │       ?fields=all                   │
                            │  POST /v2/verify/similarity         │
                            │                                     │
                            │  No API key. No auth.               │
                            └─────────────────────────────────────┘
```

**The pattern:** Sourcify is the structured-data layer. The agent fetches *everything it knows about a contract* in a handful of HTTP calls, diffs old vs new structurally, and feeds the result to the LLM as evidence — not as a freeform "here's some code, what do you think?" prompt.

## Sourcify endpoints in use

| Endpoint | Wrapped by | Returns |
| --- | --- | --- |
| `GET /check-by-addresses?addresses=…&chainIds=…` | `isVerified` | `{ status: "perfect" \| "partial" \| ... }` — the cheap pre-check |
| `GET /v2/contract/{chainId}/{address}?fields=all` | `getStorageLayout`, `getABI`, `getContractMeta`, `getNatSpec` | One blob: `match`, `compilationArtifacts.{abi, storageLayout, devdoc, userdoc}`, `onchainInfo.creationTransactionHash`, `compilation.compilerVersion` |
| `POST /v2/verify/similarity` (body: `{ bytecode, chainId }`) | `findSimilarContracts` | `{ results: [{ address, chainId, similarity }] }` — fallback when verification is missing |

All three are unauthenticated. The shape of the v2 response is captured in `SourcifyV2Response` in [`src/sourcify/index.ts`](../../src/sourcify/index.ts).

## How the diffs become severity

### Storage layout diff → [`assessRisk`](../../src/sourcify/diffStorage.ts)

The agent compares storage entries by `label` (variable name). Three signals:

| Signal | Detection | Severity |
| --- | --- | --- |
| **Moved** variable (same name, different `slot` or `offset`) | label exists in both layouts but at different positions | `CRITICAL` |
| **Removed** variable (label gone in V2) | label in old but not new | `HIGH` |
| **Added** variable (label new in V2) | label in new but not old | `MEDIUM` |
| No structural change | layouts identical by label/slot | `LOW` |

Moved is `CRITICAL` because it means slot collisions: every existing read of that variable now reads whatever V2 placed at the old slot. Such a write-after-deploy is the textbook way an upgrade silently corrupts state.

### ABI diff → [`assessFunctionRisk`](../../src/sourcify/diffFunctions.ts)

Compares the function/event/error subset of each ABI. Three flag levels:

| Flag | Trigger | Level |
| --- | --- | --- |
| Sensitive name added or modified | new or modified function whose name is in the [`CRITICAL_NAMES`](../../src/sourcify/diffFunctions.ts) set: `withdraw*`, `transfer*`, `migrate*`, `upgrade*`, `selfdestruct`, `destroy`, `kill` | `CRITICAL` |
| Functions removed | any function in old ABI but not new | `HIGH` |
| Functions added | any function in new ABI but not old | `MEDIUM` |

The pipeline takes the highest level across all flags and combines it with the storage severity (max of the two). Modifier changes (e.g. removing `onlyOwner`) don't appear in the ABI itself, so the access-loss class of vulnerability is caught by the AI analyser reading the source diff via NatSpec, not by the structural diff.

### Match-type bump

If Sourcify returns `match: "partial"` (the deployed bytecode matches the source semantically but the metadata bytes differ), the final severity is bumped by one. Partial matches mean *something* was edited at compile time after the canonical build; that edit doesn't have to be malicious, but it's a reason to look harder.

## Cheat sheet

| Function in [`src/sourcify/index.ts`](../../src/sourcify/index.ts) | Returns | Used in |
| --- | --- | --- |
| `isVerified(addr, chainId)` | `boolean` | Cheap pre-check before pulling artifacts |
| `isVerifiedWithRetry(addr, chainId, n, delayMs)` | `boolean` | Pipeline step 1 — handles "just deployed" race |
| `getStorageLayout(addr, chainId)` | `StorageLayout \| null` | Storage diff input |
| `getABI(addr, chainId)` | `unknown[] \| null` | ABI diff input |
| `getContractMeta(addr, chainId)` | `{ matchType, creationTxHash, compilerVersion }` | Drives the partial-match severity bump |
| `getNatSpec(addr, chainId)` | `{ title, notice, details, methods }` | Passed to the AI analyser as developer-intended context |
| `findSimilarContracts(addr, chainId, provider)` | `SimilarContract[]` | Fallback when an unverified contract is detected |

| Function in `diffStorage.ts` / `diffFunctions.ts` | Returns |
| --- | --- |
| `diffStorageLayouts(old, new)` | `{ removedVariables, addedVariables, movedVariables }` |
| `assessRisk(diff)` | `AlertSeverity` for the storage portion |
| `diffABIs(old, new)` | `{ addedFunctions, removedFunctions, modifiedFunctions }` |
| `assessFunctionRisk(diff)` | `RiskFlag[]` |
| `lookupSignatures(hexes[])` | `Map<hex, textSignature>` (4byte resolver — currently unused in the pipeline, available for the AI prompt if needed) |

## Why removing Sourcify breaks the pipeline

```text
┌──────────────────────────────────────────────────────────────────┐
│  Sourcify off    →   Visible damage                              │
├──────────────────────────────────────────────────────────────────┤
│  No verification →   every alert lands as CRITICAL               │
│  status              "unverified impl" — no signal, just noise   │
│                                                                  │
│  No layouts      →   storageDiff is null → severity defaults to  │
│                      MEDIUM regardless of what actually changed  │
│                                                                  │
│  No ABI          →   abiDiff is null → no function risk flags,   │
│                      sensitive-name detection silently disabled  │
│                                                                  │
│  No NatSpec      →   AI analyser gets only diffs + addresses,    │
│                      loses the "what did the dev intend?" signal │
│                                                                  │
│  No match-type   →   no partial-match severity bump              │
│                                                                  │
│  No similarity   →   unverified contracts can't be flagged as    │
│                      "looks like a known clone"                  │
└──────────────────────────────────────────────────────────────────┘
```

The pipeline is built so each missing piece degrades cleanly — the agent doesn't crash if Sourcify is down, it just produces lower-quality alerts. But the *whole point* of an upgrade auditor is judging which upgrades matter, and that judgment is what Sourcify enables.

## Why Sourcify and not Etherscan

The runtime pipeline only reads from Sourcify. Three reasons:

1. **No API key**, no rate-limit dance. The agent runs unattended and doesn't manage secrets it doesn't have to.
2. **Storage layout is first-class**, not buried in metadata. Sourcify exposes the standard `storageLayout` JSON format the Solidity compiler emits; Etherscan doesn't.
3. **Bytecode similarity is a unique Sourcify primitive.** No equivalent exists on Etherscan, and it is load-bearing for the unverified-contract path.

Etherscan still appears in the project — the demo target's [`hardhat.config.ts`](../../demo-target/hardhat.config.ts) verifies on both Sourcify and Etherscan during deploy — but that's a developer-experience concern (block-explorer rendering), not a runtime dependency.

## Verify any of this in 30 seconds

```bash
# Pick any verified contract on a Sourcify-supported chain — example: a Base mainnet ERC-1967 implementation
curl -s 'https://sourcify.dev/server/v2/contract/8453/0x000100abaad02f1cfC8Bbe32bD5a564817339E72?fields=all' \
  | jq '.match, .compilation.compilerVersion'
# → "exact_match"   "0.8.23+commit.f704f362"

# Run the agent against any RPC and watch the [Sourcify] log lines
npm run dev
```

## TL;DR

1. **Sourcify is Vigil's structured-data layer.** Without it, the agent can detect upgrades but cannot judge them.
2. **Five distinct uses, one HTTP namespace.** Verification, storage layout, ABI, NatSpec, similarity — all from `sourcify.dev/server`, no API key.
3. **The "just deployed" race is handled.** 3 retries × 30 seconds, then bytecode-similarity fallback for unverified clones.
4. **Diffs drive severity directly.** Moved slot → CRITICAL, removed → HIGH, added → MEDIUM. Sensitive function names are a separate independent flag set. Partial Sourcify match bumps the result by one.
5. **The AI analyser eats Sourcify output, not raw source.** NatSpec + structured diffs in the prompt; the LLM does qualitative reasoning on top of evidence the static layer already extracted.
