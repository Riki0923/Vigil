# Sourcify Integration

Vigil queries [Sourcify](https://sourcify.dev), a public, decentralized service for verified Solidity source code, to obtain the structured artifacts (storage layout, ABI, NatSpec, match status) that drive its proxy-upgrade risk assessment. The integration is read-only, requires no API key, and falls back to bytecode similarity matching when an implementation has not yet been verified.

## Overview

When the agent detects an EIP-1967 `Upgraded(address)` event, it queries Sourcify for both the previous and new implementation contracts and produces:

- A verification status (`exact_match`, `partial_match`, or unverified).
- The Solidity compiler's storage layout JSON for each implementation.
- The ABI for each implementation.
- The NatSpec documentation (`devdoc` and `userdoc`) for the new implementation.
- A bytecode similarity report when an implementation is unverified.

These artifacts are diffed structurally to produce a severity score and a set of risk flags before the AI analyser is invoked.

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                          Vigil Agent                             │
│                                                                  │
│   1. EIP-1967 Upgraded(address) event detected                   │
│   2. Resolve newImpl + oldImpl from EIP-1967 storage slot        │
│                                                                  │
│             ▼                                                    │
│   ┌──────────────────────────────────────────────────┐           │
│   │  src/sourcify/index.ts                           │           │
│   │                                                  │  HTTPS    │
│   │  isVerifiedWithRetry(newImpl, 2, 15s) ───────────┼──────┐    │
│   │                                                  │      │    │
│   │  if !verified:                                   │      │    │
│   │    findSimilarContracts(newImpl) ────────────────┼──────┤    │
│   │                                                  │      │    │
│   │  Promise.all([                                   │      │    │
│   │    getStorageLayout(old), getStorageLayout(new), │      │    │
│   │    getABI(old),           getABI(new),           │      │    │
│   │    getContractMeta(new),  getNatSpec(new),       │      │    │
│   │  ])                                              ├──────┤    │
│   └──────────────────────────────────────────────────┘      │    │
│             ▼                                               │    │
│   ┌──────────────────────────────────────────────────┐      │    │
│   │  src/sourcify/diffStorage.ts                     │      │    │
│   │   diffStorageLayouts → moved/removed/added slots │      │    │
│   │   assessRisk          → AlertSeverity            │      │    │
│   │                                                  │      │    │
│   │  src/sourcify/diffFunctions.ts                   │      │    │
│   │   diffABIs              → added/removed/modified │      │    │
│   │   assessFunctionRisk    → RiskFlag[]             │      │    │
│   └──────────────────────────────────────────────────┘      │    │
│             ▼                                               │    │
│   ┌──────────────────────────────────────────────────┐      │    │
│   │  src/agent/analyser.ts                           │      │    │
│   │   AI prompt = diffs + NatSpec + match metadata   │      │    │
│   └──────────────────────────────────────────────────┘      │    │
└─────────────────────────────────────────────────────────────┼────┘
                                                              ▼
                            ┌──────────────────────────────────────┐
                            │    sourcify.dev/server  (public)     │
                            │                                      │
                            │   GET  /check-by-addresses           │
                            │   GET  /v2/contract/{chain}/{addr}   │
                            │        ?fields=all                   │
                            │   POST /v2/verify/similarity         │
                            │                                      │
                            │   No API key, no authentication.     │
                            └──────────────────────────────────────┘
```

### Endpoints in use

| Endpoint | Wrapper | Purpose |
| --- | --- | --- |
| `GET /check-by-addresses` | `isVerified` | Cheap verification pre-check. Returns `{ status: "perfect" \| "partial" \| ... }`. |
| `GET /v2/contract/{chainId}/{address}?fields=all` | `getStorageLayout`, `getABI`, `getContractMeta`, `getNatSpec` | Returns `match`, `compilationArtifacts.{abi, storageLayout, devdoc, userdoc}`, `onchainInfo.creationTransactionHash`, `compilation.compilerVersion`. |
| `POST /v2/verify/similarity` | `findSimilarContracts` | Body: `{ bytecode, chainId }`. Returns ordered similarity results. Used as a fallback when verification is missing. |

The full v2 response schema is captured in the `SourcifyV2Response` interface in [`src/sourcify/index.ts`](../../src/sourcify/index.ts).

### Verification race handling

Sourcify can lag verification by several seconds after a contract is deployed. The agent applies a retry-then-fallback policy:

1. `isVerifiedWithRetry(address, chainId, 2, 15_000)`, initial check plus two retries 15 seconds apart (~30s ceiling). Demo-tuned: a longer ceiling makes the booth pacing dead-air-y. The default in [`src/sourcify/index.ts`](../../src/sourcify/index.ts) is `(3, 60_000)`; the pipeline overrides it at [`src/agent/index.ts`](../../src/agent/index.ts).
2. On persistent failure, `findSimilarContracts(address, chainId, provider)` runs against `/v2/verify/similarity`. A score of ≥ 0.9 indicates a structural clone of a known contract; the alert is raised with that context.
3. If similarity also returns nothing, an alert is emitted with `severity: CRITICAL` and the message "unverified implementation, no known relatives".

Source: [`src/agent/index.ts`](../../src/agent/index.ts), [`src/sourcify/index.ts`](../../src/sourcify/index.ts).

## Severity Model

The severity of an alert is the maximum of two independent signals: the storage-layout diff and the ABI diff. A partial Sourcify match adds a one-step bump on top.

### Storage layout diff

`diffStorageLayouts(old, new)` compares storage entries by `label` (variable name) and produces three sets:

| Signal | Detection | Severity |
| --- | --- | --- |
| Moved | label exists in both layouts at different `(slot, offset)` | `CRITICAL` |
| Removed | label in old but not new | `HIGH` |
| Added | label in new but not old | `MEDIUM` |
| No structural change | layouts identical by label and slot | `LOW` |

Implementation: [`src/sourcify/diffStorage.ts`](../../src/sourcify/diffStorage.ts).

### ABI diff

`diffABIs(old, new)` compares the function/event/error subset of each ABI and produces three flag levels:

| Trigger | Level |
| --- | --- |
| New or modified function whose name is in `CRITICAL_NAMES` (`withdraw*`, `transfer*`, `migrate*`, `upgrade*`, `selfdestruct`, `destroy`, `kill`) | `CRITICAL` |
| Functions removed from the ABI | `HIGH` |
| Functions added to the ABI | `MEDIUM` |

Implementation: [`src/sourcify/diffFunctions.ts`](../../src/sourcify/diffFunctions.ts).

ABI-level detection does not capture modifier changes (for example, removing `onlyOwner` from a function leaves the ABI signature unchanged). The AI analyser is responsible for catching access-control regressions of that class, using the NatSpec context provided alongside the structural diffs.

### Match-type bump

When `getContractMeta` reports `match: "partial"` (deployed bytecode matches the source semantically but metadata bytes differ), the final combined severity is incremented by one step. A partial match indicates a non-canonical build artifact and warrants additional scrutiny.

## API Reference

### `src/sourcify/index.ts`

| Function | Returns | Notes |
| --- | --- | --- |
| `isVerified(address, chainId)` | `Promise<boolean>` | Single-call verification pre-check. |
| `isVerifiedWithRetry(address, chainId, maxRetries, delayMs)` | `Promise<boolean>` | Pipeline entry point. Retries with the supplied cadence before resolving. |
| `getStorageLayout(address, chainId)` | `Promise<StorageLayout \| null>` | Solidity-emitted layout JSON or `null` if unavailable. |
| `getABI(address, chainId)` | `Promise<unknown[] \| null>` | Standard ABI array or `null`. |
| `getContractMeta(address, chainId)` | `Promise<{ matchType, creationTxHash, compilerVersion } \| null>` | Drives the partial-match severity bump. |
| `getNatSpec(address, chainId)` | `Promise<{ title, notice, details, methods } \| null>` | Passed to the AI analyser as developer-intended context. |
| `findSimilarContracts(address, chainId, provider)` | `Promise<SimilarContract[]>` | Sorted by similarity descending. Used only when verification is missing. |

### `src/sourcify/diffStorage.ts`

| Function | Returns |
| --- | --- |
| `diffStorageLayouts(old, new)` | `{ removedVariables, addedVariables, movedVariables }` |
| `assessRisk(diff)` | `AlertSeverity` for the storage portion |

### `src/sourcify/diffFunctions.ts`

| Function | Returns |
| --- | --- |
| `diffABIs(old, new)` | `{ addedFunctions, removedFunctions, modifiedFunctions }` |
| `assessFunctionRisk(diff)` | `RiskFlag[]` |
| `lookupSignatures(hexes[])` | `Map<hex, textSignature>`. 4byte resolver. Not currently invoked by the pipeline. |

## Configuration

The integration requires no environment variables and no credentials. The Sourcify base URL (`https://sourcify.dev/server`) is pinned in source.

## Failure Modes

| Condition | Effect | Remediation |
| --- | --- | --- |
| Sourcify unreachable for the new implementation after retries and similarity lookup | Alert is emitted with `severity: CRITICAL` and the rationale "unverified implementation". | Investigate the unverified contract manually. The agent does not block on Sourcify availability. |
| `getStorageLayout` returns `null` for either implementation | The storage diff is skipped; severity defaults to `MEDIUM` for the storage portion. | Confirm the contract is verified with full metadata on Sourcify. Partial verifications without storage layout are common for older contracts. |
| `getABI` returns `null` for either implementation | The ABI diff is skipped; sensitive-name detection is bypassed. | Same as above. |
| `getNatSpec` returns `null` | The AI analyser receives diffs only; qualitative reasoning quality may decrease. | The integration is robust to missing NatSpec; this is informational, not actionable. |

## Why Sourcify rather than Etherscan

The runtime pipeline reads exclusively from Sourcify. Reasoning:

1. **No authentication.** The agent runs unattended and cannot manage credentials it does not need.
2. **First-class storage layout.** Sourcify exposes the Solidity compiler's `storageLayout` JSON directly; Etherscan does not.
3. **Bytecode similarity primitive.** Sourcify's `/v2/verify/similarity` has no equivalent on Etherscan and is essential to the unverified-contract fallback path.

Etherscan is still used during demo deployment ([`demo-target/hardhat.config.ts`](../../demo-target/hardhat.config.ts) verifies V1/V2 implementations on both Sourcify and Etherscan), but only for block-explorer presentation, not for the runtime decision pipeline.

## Verification

The integration can be exercised against any verified contract on a Sourcify-supported chain:

```bash
# Inspect the v2 response shape for any verified contract
curl -s 'https://sourcify.dev/server/v2/contract/8453/0x000100abaad02f1cfC8Bbe32bD5a564817339E72?fields=all' \
  | jq '.match, .compilation.compilerVersion'

# Run the agent against any RPC and observe the [Sourcify] log lines on each upgrade
npm run dev
```

## References

- [Sourcify documentation](https://docs.sourcify.dev/)
- [Sourcify v2 API reference](https://docs.sourcify.dev/docs/api/server/v2/)
- [Solidity storage layout JSON output](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#json-output)
- [EIP-1967: Standard Proxy Storage Slots](https://eips.ethereum.org/EIPS/eip-1967)
