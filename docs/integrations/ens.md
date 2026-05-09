# ENS Integration

Vigil uses [ENS](https://ens.domains) on **Ethereum mainnet** (production parent `vigilbot.eth`) and **Ethereum Sepolia** (dev parent `vigil.eth`) as its identity, configuration, off-chain discovery, multichain target binding, L2 reverse-naming, and reputation log. The agent both reads from and writes to ENS as part of its normal runtime.

## Networks

The agent and frontend pick a network at runtime via the `VIGIL_ENS_NETWORK` environment variable:

| Network | Parent | Subnames point at | Default for |
| --- | --- | --- | --- |
| `mainnet` | `vigilbot.eth` (Ethereum mainnet, chain id 1) | Base mainnet (chain id 8453) addresses via ENSIP-11 coin type `2147491981` | **frontend** |
| `sepolia` | `vigil.eth` (Ethereum Sepolia, chain id 11155111) | Base Sepolia (chain id 84532) addresses via ENSIP-11 coin type `2147567180` | **agent runtime** (backward compatibility) |

Both networks share the same record schema and reputation log mechanism. The agent module (`src/ens/`) exposes network-keyed accessors (`getEnsContracts(network)`, `getEnsProvider(network)`, `getEnsSigner(network)`) so scripts can target either network with a `--network=sepolia|mainnet` CLI flag. Set `VIGIL_ENS_NETWORK=mainnet` on the production Worker to read from `vigilbot.eth`.

## Overview

Six distinct concerns are served by ENS records on the active parent and its subnames:

| # | Concern | Records | Subname |
| --- | --- | --- | --- |
| 1 | Identity | `description`, `url` | `agent.vigil.eth` |
| 2 | Runtime configuration | `vigil.capabilities` (JSON), `vigil.severity-min` | `agent.vigil.eth` |
| 3 | Off-chain feed discovery | `vigil.feed` | `agent.vigil.eth` |
| 4 | Multichain target binding (ENSIP-11) | `addr[base-sepolia]` | each watched-target subname (e.g. `demo.vigil.eth`) |
| 5 | L2 reverse name (ENSIP-19) | reverse record on Base Sepolia | the watched contract on Base Sepolia |
| 6 | Reputation log | `vigil.last-severity`, `vigil.last-upgrade-at`, `vigil.last-tx`, `vigil.upgrade-count` | each watched-target subname, written by the agent |

The agent reads concerns 1–4 at boot and on each upgrade event, and writes concern 6 after every emitted alert. The dashboard reads identity and reputation server-side at request time.

## Architecture

```text
┌──────────────────────────────────────────────────────────┐
│         ETHEREUM SEPOLIA — vigil.eth (parent)            │
│                                                          │
│   ┌────────────────────┐    ┌─────────────────────┐      │
│   │  agent.vigil.eth   │    │   demo.vigil.eth    │      │
│   │                    │    │                     │      │
│   │  description       │    │  description        │      │
│   │  url               │    │  vigil.kind         │      │
│   │  vigil.capabilities│    │  addr[base-sepolia] │      │
│   │  vigil.severity-min│    │  vigil.last-severity│      │
│   │  vigil.feed        │    │  vigil.last-tx      │      │
│   │  vigil.payment     │    │  vigil.last-upgrade │      │
│   │                    │    │  vigil.upgrade-count│      │
│   └────────▲───────────┘    └─────────▲───────────┘      │
└────────────┼──────────────────────────┼──────────────────┘
             │ READ at boot             │ WRITE 4× per alert
             │                          │ (setText)
             │                          │
       ┌─────┴──────────────────────────┴────────┐
       │                Vigil Agent              │
       │     src/ens/{reader, writer, cache}     │
       └─────────────────────────────────────────┘
                       │
                       │ alerts + resolved names
                       ▼
       ┌──────────────────────────────────────┐
       │           Dashboard (Next.js)        │
       │       frontend/lib/ens.ts (viem)     │
       │                                      │
       │   reads agent.vigil.eth → identity   │
       │   reads target subname  → reputation │
       └──────────────────────────────────────┘
```

ENS is the single source of truth for these concerns. Subscribers and downstream tools read from ENS without coordination with Vigil's infrastructure.

### ENSIP mechanisms in use

- **ENSIP-5 text records.** All `description`, `url`, and `vigil.*` keys are plain text records on the resolver. The dashboard reads them via viem's `getEnsText`; the agent reads them via ethers' `Resolver.getText`.
- **ENSIP-11 multichain address records.** Watched-target subnames carry an `addr` typed for the Base Sepolia coin type (`0x80000000 | 84532 = 2147567180`). A name resolved on Sepolia returns a Base Sepolia address; the resolution lives entirely on Sepolia regardless of where the resolved address operates.
- **ENSIP-19 L2 reverse names.** The watched contract on Base Sepolia has its primary name set to the target subname via the L2 reverse registrar. For `OwnableUpgradeable` contracts (such as the demo proxy), the call uses `setNameForOwnableWithSignature` — the contract owner's ERC-191 signature authorizes the registrar, with no modification to the watched contract required.

## Subname Records Reference

### Agent identity (`agent.vigil.eth`)

| Record | Type | Description |
| --- | --- | --- |
| `description` | text | Human-readable agent description. Surfaced in the dashboard identity card. |
| `url` | text | Project URL. Surfaced in the dashboard identity card. |
| `vigil.capabilities` | text (JSON) | `{ watch: string[], chains: string[], output: string[] }`. Read at boot and logged. |
| `vigil.severity-min` | text | One of `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. Severity floor applied to every alert before publication. |
| `vigil.feed` | text | Public Swarm feed URL where alerts are published. Discovered by subscribers. |
| `vigil.payment` | text | Optional payment endpoint for paid subscribers. Surfaced in the dashboard. |

### Watched targets (`<protocol>.vigil.eth`)

| Record | Type | Description |
| --- | --- | --- |
| `description` | text | Human-readable target description. |
| `vigil.kind` | text | Target classification, e.g. `demo-proxy`, `lending`, `dex`. Surfaced as a chip in the reputation panel. |
| `addr[base-sepolia]` | ENSIP-11 addr | Address of the watched contract on Base Sepolia. The ENSIP-11 coin type is `2147567180`. |
| `vigil.last-severity` | text | Severity of the most recent alert: `LOW \| MEDIUM \| HIGH \| CRITICAL`. Written by the agent after every alert. |
| `vigil.last-upgrade-at` | text | ISO-8601 timestamp of the most recent alert. Written by the agent. |
| `vigil.last-tx` | text | Transaction hash that triggered the most recent alert. Written by the agent. |
| `vigil.upgrade-count` | text (numeric) | Monotonic counter of total alerts emitted for this target. Read-modify-incremented in [`src/ens/writer.ts`](../../src/ens/writer.ts). |

## Dashboard Surfaces

The dashboard renders ENS records server-side via viem against Sepolia. Two surfaces are user-visible.

### Agent Identity Card (top of dashboard)

```text
╔══════════════════════════════════════════════════════════════╗
║  ● AGENT IDENTITY · resolved live from Ethereum Sepolia ENS  ║
║                                                               ║
║  agent.vigil.eth                          [view on ENS app ↗]║
║                                                               ║
║  Vigil — autonomous proxy upgrade auditor                     ║
║  https://github.com/Riki0923/Vigil ↗                          ║
║                                                               ║
║  SEVERITY FLOOR  [MEDIUM]                                     ║
║  CAPABILITIES    [watch:proxy-upgrade-eip-1967]               ║
║                  [chain:base] [chain:base-sepolia]            ║
║                  [out:swarm-feed] [out:json-file]             ║
║                                                               ║
║  VIGIL.FEED      bzz.limo/feeds/0x4b29…/94f6a4… ↗            ║
║                  subscribers discover via ENS                 ║
║                                                               ║
║  VIGIL.PAYMENT   x402-planned:github.com/Riki0923/Vigil      ║
║                  X402 endpoint (roadmap), discoverable via ENS║
╚══════════════════════════════════════════════════════════════╝
```

Source: `fetchAgentIdentity("agent.vigil.eth")` reads the six identity records on `agent.vigil.eth`.

### ENS Reputation Panel (inline on every named alert)

```text
╔════════════════════════════════════════════════════════════╗
║ ●  ENS REPUTATION  demo.vigil.eth                          ║
║    [1 upgrade tracked]  [last CRITICAL]  demo-proxy        ║
║                                                            ║
║    ADDR[BASE-SEPOLIA]    0x6595…21AD                       ║
║    VIGIL.LAST-TX         0x000000…000001 ↗                 ║
║    VIGIL.LAST-UPGRADE-AT 38m ago                           ║
║    VIGIL.UPGRADE-COUNT   1                                 ║
║                                                            ║
║    resolved live from Sepolia ENS                          ║
║    written back by the agent after each alert              ║
║                                                            ║
║                                       [view on ENS app ↗] ║
╚════════════════════════════════════════════════════════════╝
```

Source: `fetchTargetReputations(names)` reads ENSIP-11 addr plus the four `vigil.last-*` reputation records per target. The four reputation records are the bidirectional half of the integration — written by the agent, not seeded once.

## Data Flow

### Boot (once per agent process)

```text
Agent ──► ENS Sepolia: read agent.vigil.eth (six text records)
ENS   ──► identity, capabilities, severity floor, vigil.feed, vigil.payment
Agent: applies severity floor; loads name cache from data/ens-targets.json
```

### Upgrade detection (per event)

```text
Chain     ──► Agent: Upgraded(<address>)
Agent: cached lookup proxyAddress → "<protocol>.vigil.eth"
Agent: structural diff + AI analysis → severity
Agent: severity ≥ floor? if yes, publish alert
Agent     ──► ENS Sepolia: 4 setText calls on <protocol>.vigil.eth
              (last-severity, last-upgrade-at, last-tx, upgrade-count++)
```

### Dashboard page load

```text
Dashboard ──► ENS Sepolia (server-side, viem):
              fetchAgentIdentity("agent.vigil.eth")
              fetchTargetReputations([names from current alerts])
ENS       ──► records → AgentIdentityCard + EnsReputationPanel
```

### External subscriber

```text
Subscriber ──► ENS Sepolia: resolve agent.vigil.eth → vigil.feed
Subscriber ──► resolve <protocol>.vigil.eth → vigil.last-severity
```

No Vigil-controlled endpoint is involved.

## Configuration

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `VIGIL_ENS_NETWORK` | No (defaults: agent → `sepolia`, frontend → `mainnet`) | `mainnet` or `sepolia`. Selects which parent the runtime reads from. |
| `ETH_SEPOLIA_RPC_URL` | Yes when `VIGIL_ENS_NETWORK=sepolia` | Ethereum Sepolia JSON-RPC endpoint. Used for reads + writes against `vigil.eth`. |
| `ETH_MAINNET_RPC_URL` | Yes when `VIGIL_ENS_NETWORK=mainnet` | Ethereum mainnet JSON-RPC endpoint. Used for reads + writes against `vigilbot.eth`. |
| `ENS_REGISTRAR_PRIVATE_KEY` | For write operations only | Wallet that owns the parent name. The same key signs both Sepolia and mainnet writes; it must own `vigil.eth` on Sepolia and/or `vigilbot.eth` on mainnet for the corresponding network's writes to succeed. |
| `VIGIL_PARENT_ENS_NAME` | No (default `vigil.eth`) | Override for the Sepolia parent name. |
| `VIGIL_PARENT_ENS_NAME_MAINNET` | No (default `vigilbot.eth`) | Override for the mainnet parent name. |
| `VIGIL_AGENT_ENS_NAME` | No (default `agent.vigil.eth`) | Override for the Sepolia agent subname. |
| `VIGIL_AGENT_ENS_NAME_MAINNET` | No (default `agent.vigilbot.eth`) | Override for the mainnet agent subname. |

### File-based configuration

| File | Purpose |
| --- | --- |
| `data/ens-targets.json` | Map from contract address to ENS name. Populated by the seed script and read by the agent on boot for alert tagging. |

## Module Reference

### Backend (`src/ens/`)

| Module | Exports |
| --- | --- |
| [`client.ts`](../../src/ens/client.ts) | `ENS_SEPOLIA` + `ENS_MAINNET` contract address constants, network-keyed accessors `getEnsContracts(network)` / `getEnsProvider(network)` / `getEnsSigner(network)`, plus per-network shortcuts (`getSepoliaProvider`, `getMainnetProvider`, etc.) and ENSIP-11 coin type helpers. |
| [`abi.ts`](../../src/ens/abi.ts) | Minimal ABIs for the ENS Registry, public Resolver, NameWrapper, and L2 ReverseRegistrar. |
| [`records.ts`](../../src/ens/records.ts) | Typed record key constants and parsers for `vigil.capabilities` and `vigil.severity-min`. |
| [`reader.ts`](../../src/ens/reader.ts) | `resolveAgentConfig`, `resolveTargetConfig`, `isNameRegistered`. Selects active network via `VIGIL_ENS_NETWORK`. |
| [`writer.ts`](../../src/ens/writer.ts) | `updateTargetReputation` — performs the four `setText` calls per alert against the active network. |
| [`cache.ts`](../../src/ens/cache.ts) | Address-to-name lookup backed by `data/ens-targets.json`. |

### Frontend (`frontend/lib/ens.ts`)

| Function | Returns | Description |
| --- | --- | --- |
| `fetchAgentIdentity(name)` | `Promise<AgentIdentity>` | Reads the six identity records on `agent.vigil.eth` server-side via viem. |
| `fetchTargetReputation(name)` | `Promise<TargetReputation>` | Reads description, kind, ENSIP-11 addr, and the four reputation records for one target. |
| `fetchTargetReputations(names)` | `Promise<TargetReputation[]>` | Batch variant for the dashboard's per-alert reputation panels. |

## Operational Scripts

All ENS scripts under `scripts/ens/` accept `--network=sepolia|mainnet` (default `sepolia`). The Base reverse-name script (`set-base-primary`) takes a different flag, `--network=base-sepolia|base-mainnet` (default `base-sepolia`), because it operates on the Base L2 reverse registrar rather than the Ethereum parent.

| Command | Purpose |
| --- | --- |
| `tsx scripts/ens/check-parent.ts [--network=mainnet]` | Confirms wallet balance, name availability, and current price for the parent registration on the chosen network. |
| `tsx scripts/ens/register-parent.ts [--network=mainnet] [--name=<x>]` | Performs the commit-reveal flow plus native NameWrapper wrap for the parent name. |
| `tsx scripts/ens/seed-subnames.ts [--network=mainnet]` | Creates the agent and target subnames and writes initial records (`description`, `url`, `vigil.capabilities`, `vigil.severity-min`, ENSIP-11 addr). |
| `tsx scripts/ens/sync-feed.ts [--network=mainnet]` | Writes the current Swarm feed URL to `agent.<parent>` as `vigil.feed`. Run after pinning a new `SWARM_PRIVATE_KEY`. |
| `tsx scripts/ens/set-base-primary.ts [--network=base-mainnet]` | Submits the ENSIP-19 reverse record on Base for the watched proxy. |
| `tsx scripts/ens/resolve.ts [--network=mainnet] <name>` | Reads every text record and the ENSIP-11 addr for a name. Used for verification. |

## Failure Modes

| Condition | Effect | Remediation |
| --- | --- | --- |
| `ETH_SEPOLIA_RPC_URL` unset | Agent runs in legacy mode: no severity floor (every alert publishes), no proxy-name tagging on alerts, no reputation writeback. | Set `ETH_SEPOLIA_RPC_URL`. |
| `agent.vigil.eth` unreachable at boot | Severity floor and `vigil.feed` advertisement are not applied; agent logs a warning and continues. | Verify the resolver and the records via `npm run ens:resolve agent.vigil.eth`. |
| `data/ens-targets.json` missing or stale | Alerts emit with bare hex addresses instead of human names. | Run `npm run ens:seed` to repopulate. |
| `vigil.feed` not published | Subscribers cannot discover the agent's feed URL. | Run `npm run ens:sync-feed`. |
| ENSIP-19 reverse not set on a watched contract | Block explorers show bare hex on Base Sepolia. | Run `npm run ens:set-base-primary`. |
| `ENS_REGISTRAR_PRIVATE_KEY` unset | Reputation `setText` calls are skipped. The agent logs a warning and otherwise operates normally. | Provide the private key for the wallet that owns the parent name. |

## Verification

```bash
# Mainnet (production)
tsx scripts/ens/resolve.ts --network=mainnet agent.vigilbot.eth   # six records on the agent identity
tsx scripts/ens/resolve.ts --network=mainnet demo.vigilbot.eth    # ENSIP-11 addr + reputation records

# Sepolia (dev / legacy)
tsx scripts/ens/resolve.ts agent.vigil.eth                        # six records on the agent identity
tsx scripts/ens/resolve.ts demo.vigil.eth                         # ENSIP-11 addr + reputation records

cd frontend && npm run dev                                         # dashboard surfaces both (frontend defaults to mainnet)
```

Live ENS app views:

- Mainnet: <https://app.ens.domains/agent.vigilbot.eth>
- Sepolia: <https://app.ens.domains/agent.vigil.eth?network=sepolia>

## References

- [ENS documentation](https://docs.ens.domains/)
- [ENSIP-5: Text Records](https://docs.ens.domains/ensip/5)
- [ENSIP-11: Multichain Address Resolution](https://docs.ens.domains/ensip/11)
- [ENSIP-19: L2 Reverse Resolvers](https://docs.ens.domains/ensip/19)
- [SLIP-44 coin type registry](https://github.com/satoshilabs/slips/blob/master/slip-0044.md)
