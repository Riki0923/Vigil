# How ENS is used in Vigil

Read the **plain English** section first. Technical detail and diagrams below.

---

## In plain English (start here)

### What is ENS?

ENS is the Ethereum Name Service — domain names for Ethereum. A name like `vigil.eth` is owned by a wallet, registered through the ENS Public Resolver, and can carry arbitrary key/value records: addresses, descriptions, links, configuration JSON, anything that fits as a text string.

Most projects use ENS for one job: turn a name into a wallet address. Vigil uses it for six.

### Why ENS matters for Vigil

Vigil is an autonomous agent — it watches Ethereum 24/7 for risky proxy upgrades and publishes alerts. As soon as you have an agent acting on chain, two questions surface:

1. **How does anyone find this agent?** Without ENS: hardcoded URLs, env vars, or a centralized API directory. With ENS: resolve `agent.vigil.eth` and you get the agent's description, capabilities, the feed where it publishes alerts, and a payment endpoint — no API key, no docs, no registry.
2. **How does another agent know what Vigil has flagged on a specific protocol?** Without ENS: call a private API, deal with auth, hope it's online. With ENS: resolve `usdc.vigil.eth` and read the latest severity, the upgrade count, the last transaction. Already on chain, queryable from anywhere.

ENS is Vigil's **identity + configuration + discovery layer + audit log** — all the same names, all on chain.

### The clever bit: read AND write

Most ENS-for-agent uses only *read*. They register a name, put metadata in it, that's it.

Vigil **reads ENS at boot AND writes back to ENS after every alert.** Four text records on the target's subname update each time the agent detects an upgrade: last severity, last transaction, last upgrade time, total upgrade count. The bidirectional pattern turns ENS itself into a live, on-chain reputation log — any other service in the ecosystem can query it without permission, without an API, without trust.

### The five ENS jobs in one breath

- **Identity** — `agent.vigil.eth` carries `description` and `url`.
- **Runtime configuration** — the same subname carries `vigil.capabilities` (JSON) and `vigil.severity-min` (the floor that gates which alerts the agent emits).
- **Off-chain discovery** — `vigil.feed` on `agent.vigil.eth` holds the Swarm subscriber URL.
- **Multichain target binding (ENSIP-11)** — `demo.vigil.eth` carries `addr[base-sepolia]` (coin type `2147567180`), pointing the agent at a Base address while the name itself lives on Sepolia.
- **L2 reverse naming (ENSIP-19)** — `demo.vigil.eth` is set as the primary name for the demo proxy on Base Sepolia, so block explorers display the human name instead of bare hex.
- **Live reputation log** — `vigil.last-severity`, `vigil.last-upgrade-at`, `vigil.last-tx`, `vigil.upgrade-count` on each target subname, written by the agent after every alert.

---

## Now the technical details

## The whole thing in one picture

```text
┌──────────────────────────────────────────────────────────┐
│         ETHEREUM SEPOLIA — vigil.eth (parent)            │
│                                                          │
│   ┌────────────────────┐    ┌─────────────────────┐      │
│   │  agent.vigil.eth   │    │   demo.vigil.eth    │      │
│   │  (the agent)       │    │   (a watched proxy) │      │
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
             │ READ at boot             │ WRITE after every
             │                          │ alert (4 setText)
             │                          │
       ┌─────┴──────────────────────────┴─────┐
       │            VIGIL AGENT                │
       │   src/ens/{reader, writer, cache}     │
       └──────────────────────────────────────┘
                       │
                       │ alerts +
                       │ resolved names
                       ▼
       ┌──────────────────────────────────────┐
       │      DASHBOARD (Next.js)              │
       │   frontend/lib/ens.ts (viem)          │
       │                                       │
       │   reads agent.vigil.eth → identity   │
       │   reads target subname  → reputation │
       └──────────────────────────────────────┘
```

**The pattern:** ENS is the single source of truth. The agent reads from it, writes to it. The dashboard reads from it. Subscribers read from it. No separate database, no API, no registry.

## Subname records reference

| Subname | Purpose | Records |
| --- | --- | --- |
| `agent.vigil.eth` | Agent identity. Read at boot. | `description`, `url`, `vigil.capabilities` (JSON), `vigil.severity-min`, `vigil.feed`, `vigil.payment` |
| `demo.vigil.eth` | A watched proxy contract, pointed at Base Sepolia by ENSIP-11. | `description`, `vigil.kind`, `addr[base-sepolia]`, plus the four reputation records |
| `<protocol>.vigil.eth` | Any other watched contract. | Same shape as `demo.vigil.eth` |

The reputation records on every target subname:

| Record | Set by | Meaning |
| --- | --- | --- |
| `vigil.last-severity` | Agent, after every alert | Most recent severity emitted for this target (`LOW \| MEDIUM \| HIGH \| CRITICAL`) |
| `vigil.last-upgrade-at` | Agent, after every alert | ISO-8601 timestamp of the most recent alert |
| `vigil.last-tx` | Agent, after every alert | Tx hash of the upgrade that triggered the alert |
| `vigil.upgrade-count` | Agent, after every alert | Monotonic counter, read-modify-incremented in [`src/ens/writer.ts`](../../src/ens/writer.ts) |

## Three ENS mechanisms doing the work

- **ENSIP-5 text records.** All the `description`, `url`, and `vigil.*` keys are plain text records on the resolver. The dashboard reads them via viem's `getEnsText`; the agent reads them via ethers' `Resolver.getText`.
- **ENSIP-11 multichain address records.** `demo.vigil.eth` carries an `addr` typed for the Base Sepolia coin type (`0x80000000 | 84532 = 2147567180`). The frontend resolves the name on Sepolia and renders Base Sepolia state — one name, two chains, no env-var hardcoding.
- **ENSIP-19 L2 reverse names.** The demo proxy on Base Sepolia has its primary name set to `demo.vigil.eth` via the L2 reverse registrar. Because the proxy is `OwnableUpgradeable`, the call uses `setNameForOwnableWithSignature` — the deployer wallet's ERC-191 signature authorizes the registrar to set the name on the proxy's behalf, with no contract change required.

## How the data flows

```text
1 — AGENT BOOT (once per process)
    Agent ──► ENS Sepolia: read agent.vigil.eth
    ENS   ──► identity + vigil.severity-min + vigil.feed
    Agent: verifies vigil.feed matches getCurrentFeedUrl();
           warns if stale

2 — UPGRADE DETECTED (per event)
    Chain ──► Agent: Upgraded(0x6595…)
    Agent: cached lookup proxyAddress → "demo.vigil.eth"
    Agent: diff + score → CRITICAL
    Agent: severity ≥ floor? if yes, continue
    Agent ──► ENS Sepolia: 4 setText calls on demo.vigil.eth
                           (last-severity, last-upgrade-at,
                            last-tx, upgrade-count++)

3 — DASHBOARD PAGE LOAD (any user)
    Dashboard ──► ENS Sepolia (server-side via viem):
                  fetchAgentIdentity("agent.vigil.eth")
                  fetchTargetReputations([proxy names from alerts])
    ENS       ──► records → AgentIdentityCard + EnsReputationPanel

4 — SUBSCRIBER (any external service)
    Subscriber ──► ENS Sepolia: resolve agent.vigil.eth → vigil.feed
    Subscriber ──► resolve usdc.vigil.eth   → vigil.last-severity
    No API key, no auth, no Vigil-controlled endpoint involved.
```

## Cheat sheet

| Module | Purpose |
| --- | --- |
| [`src/ens/client.ts`](../../src/ens/client.ts) | Sepolia provider/signer wiring, ENSIP-11 coin type helpers |
| [`src/ens/abi.ts`](../../src/ens/abi.ts) | Minimal ABIs for ENS Registry, Resolver, NameWrapper, L2ReverseRegistrar |
| [`src/ens/records.ts`](../../src/ens/records.ts) | Typed record key constants + parsers for capabilities and severity |
| [`src/ens/reader.ts`](../../src/ens/reader.ts) | `resolveAgentConfig`, `resolveTargetConfig`, `isNameRegistered` |
| [`src/ens/writer.ts`](../../src/ens/writer.ts) | `updateTargetReputation` — 4 `setText` calls per alert |
| [`src/ens/cache.ts`](../../src/ens/cache.ts) | `data/ens-targets.json` — address → name lookups for alert tagging |
| [`frontend/lib/ens.ts`](../../frontend/lib/ens.ts) | viem-based reader for the dashboard (`fetchAgentIdentity`, `fetchTargetReputation`) |

| Operational script | Purpose |
| --- | --- |
| `npm run ens:check` | Wallet balance + name availability + price |
| `npm run ens:register` | Commit-reveal + native NameWrapper wrap of a parent name |
| `npm run ens:seed` | Create subnames and write initial records |
| `npm run ens:sync-feed` | Publish the agent's Swarm feed URL to `agent.vigil.eth` as `vigil.feed` |
| `npm run ens:set-base-primary` | Set the L2 reverse record on Base Sepolia for the demo proxy |
| `npm run ens:resolve <name>` | Read every text record + ENSIP-11 addr — used as the verification command throughout |

## Why removing ENS breaks the pipeline

```text
┌──────────────────────────────────────────────────────────────────┐
│  ENS turned off  →   Visible damage                              │
├──────────────────────────────────────────────────────────────────┤
│  agent.vigil.eth →   severity floor disappears, every alert      │
│  unreachable         publishes regardless of priority            │
│                                                                  │
│  Address cache   →   alerts render bare hex in console + UI      │
│  not populated                                                   │
│                                                                  │
│  No vigil.feed   →   subscribers can't find where to read alerts │
│                                                                  │
│  No reputation   →   `resolve <protocol>.vigil.eth` returns      │
│  writeback           nothing — no agent-to-agent reputation log  │
│                                                                  │
│  No ENSIP-19     →   block explorers show 0x6595… instead of     │
│  reverse             demo.vigil.eth                              │
│                                                                  │
│  No ENSIP-11     →   the dashboard's revoke flow falls back to   │
│                      a hardcoded env var instead of resolving    │
│                      the proxy address from ENS                  │
└──────────────────────────────────────────────────────────────────┘
```

The agent's boot log literally prints these states (`[Vigil/ENS] Alert severity floor: none (all alerts emitted)`), so the "removing ENS visibly breaks the product" claim is verifiable from the logs alone.

## Verify any of this in 30 seconds

```bash
npm run ens:resolve agent.vigil.eth   # → 6 records, all live
npm run ens:resolve demo.vigil.eth    # → reputation + addr
cd frontend && npm run dev            # → AgentIdentityCard + ENS Reputation Panel
```

Or open `https://app.ens.domains/agent.vigil.eth?network=sepolia` in any browser.

## TL;DR

1. **The agent's runtime config lives in ENS.** `agent.vigil.eth` carries severity floor + capabilities + feed URL — read at boot, gates every alert.
2. **The agent writes back to ENS after every alert.** Four text records per target subname turn ENS into a live reputation log.
3. **The dashboard renders both.** `AgentIdentityCard` reads `agent.vigil.eth`. `EnsReputationPanel` reads the target subname. Both server-side via viem against Sepolia.
4. **The dashboard's runtime addresses come from ENS, not env vars.** The demo proxy address resolves through `addr[base-sepolia]` on `demo.vigil.eth` (ENSIP-11). `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA` survives only as a fallback when `SEPOLIA_RPC_URL` is unset.
5. **Block explorers display the human name.** ENSIP-19 reverse on the proxy via owner-signed authorization — no contract change.
