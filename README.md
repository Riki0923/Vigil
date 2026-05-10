# Vigil

> Autonomous agent that watches Ethereum proxy upgrades in real time and flags risky changes within seconds.

Proxy upgrades are one of the most exploited surfaces in DeFi. Auditors are slow, expensive, and asleep at 3 AM. Vigil closes the gap between "an upgrade lands on chain" and "someone qualified looks at it."

## How it works

Vigil watches every block on **Base mainnet** (chainId 8453) for EIP-1967 `Upgraded(address)` events — Base Sepolia (84532) is supported as the dev / demo environment. When one fires, the pipeline runs:

1. **Detect** — [`upgradeWatcher`](src/watchers/upgradeWatcher.ts) reads the new implementation from the event and the old implementation from the EIP-1967 storage slot at `block - 1`.
2. **Verify** — [`sourcify`](src/sourcify/index.ts) checks Sourcify (with retries), and if unverified, runs a bytecode similarity search to flag possible clones of known contracts.
3. **Diff** — storage layouts ([`diffStorage`](src/sourcify/diffStorage.ts)) and ABIs ([`diffFunctions`](src/sourcify/diffFunctions.ts)) are compared. Moved/removed slots and added/removed/modified functions become risk flags. Sensitive names (`upgradeTo`, `withdraw`, `selfdestruct`, …) bump severity.
4. **Score** — combines storage and function risk into `LOW | MEDIUM | HIGH | CRITICAL`. Partial Sourcify matches bump severity by one.
5. **Analyse** — [`agent/analyser`](src/agent/analyser.ts) sends the diff bundle (plus NatSpec when available) to OpenAI `gpt-4o` and returns a structured `{summary, explanation, recommendation, confidence}` JSON.
6. **Publish** — the alert is logged, appended to [`data/alerts.json`](data/) (per-chain, so Base mainnet alerts and Base Sepolia alerts route to separate stores), and uploaded to Swarm via [`@ethersphere/bee-js`](src/swarm/index.ts) through the `bzz.limo` gateway (no postage stamp required). The `{alert, block}` envelope is added to a single Mantaray manifest under `blocks/<n>`; the manifest's signed feed (topic `vigil-manifest`) is the canonical subscriber endpoint and persists across restarts when `SWARM_PRIVATE_KEY` is pinned. After each alert, the agent also writes four reputation text records (`vigil.last-severity`, `vigil.last-upgrade-at`, `vigil.last-tx`, `vigil.upgrade-count`) back to the matching subname on `vigilbot.eth` (Ethereum mainnet) — turning ENS into a live, on-chain reputation log other agents can read.

The frontend pulls alerts from (in order) the configured Swarm feed URL, local `data/alerts.json` for Base mainnet, `data/alerts-base-sepolia.json` (or an inline TS seed) for Base Sepolia, falling back to mock data when nothing is available. A chain selector switches the view between Base and Base Sepolia, and any alert can be opened in a per-alert AI chat grounded in that alert's JSON. The dashboard's header card resolves `agent.vigilbot.eth` live from Ethereum mainnet ENS (description, capabilities, severity floor, `vigil.feed` URL); each alert card embeds a reputation panel resolved from the matching target subname.

When the demo wallet (or a wallet the user has connected) has a non-zero approval on the same proxy that just emitted an upgrade alert, the alert card surfaces a **"Your wallet is exposed — revoke approval"** banner. One click submits `approve(spender, 0)`. If the user has an injected wallet connected, wagmi routes the tx through it (MetaMask popup, chain-switch prompt if needed); otherwise the frontend falls back to signing directly via viem with the embedded testnet `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY` so the demo can run hands-off.

## Repository layout

```text
src/                         backend agent (TypeScript, Node.js, ESM)
├── agent/                   pipeline entrypoint + AI analyser
├── watchers/                EIP-1967 Upgraded event listener
├── sourcify/                verification, storage/ABI diffs, similarity
├── alerts/                  Alert type + severity + console rendering
├── delivery/                logAlert + atomic JSON store (data/alerts.json)
├── swarm/                   bee-js Mantaray manifest publisher (blocks/<n>)
└── ens/                     Ethereum Sepolia ENS reader + reputation writer
                             for vigil.eth and its subnames

scripts/                     one-shot operational scripts
├── ens/                     check-parent, register-parent, seed-subnames,
│                            set-base-primary, sync-feed, resolve
└── swarm/                   seed-feed (bootstrap alert so vigil.feed resolves
                             before the first real upgrade)

frontend/                    Next.js 16 dashboard (React 19, Tailwind v4)
├── app/page.tsx             thin entry — fetches alerts + agent identity +
│                            target reputations server-side, renders <Dashboard />
├── app/components/          Dashboard, AlertList (with inline EnsReputationPanel),
│                            AgentIdentityCard, ChatPanel, UpgradesChart,
│                            ChainSelector, ConnectButton, RevokeBanner,
│                            ViewChainContext, Web3Provider, CopyButton
├── app/api/chat/route.ts    streaming AI chat grounded on a single alert
└── lib/                     types, alert loader (Swarm + JSON + seed),
                             wallet config (wagmi/viem), approval hooks,
                             ENS resolver (viem, server-side),
                             formatters, mock + seed alerts

demo-target/                 Hardhat sub-project — intentionally-vulnerable
                             UUPS proxy on Base Sepolia for driving demos
├── contracts/               DemoTokenV1.sol + DemoTokenV2.sol (3 deliberate sins)
├── scripts/                 deploy-proxy, trigger-upgrade, reset,
│                            seed-demo-wallet (mint + approve for revoke flow)
├── deployments/             per-network JSON written by deploy-proxy (gitignored)
└── DEPLOYMENTS.md           live test addresses + replay instructions

data/alerts.json             Base mainnet alert store (gitignored)
data/alerts-base-sepolia.json  Base Sepolia alert store (gitignored)
docs/                        development plan, pitch, swarm notes,
                             specs, plans, ideas, mentor feedback
```

## Stack

### Backend

- TypeScript (ESM, NodeNext) on Node.js, run with `tsx`
- [ethers v6](https://docs.ethers.org/) for RPC + event subscription
- [Sourcify v2](https://sourcify.dev) for verified sources, storage layouts, ABIs, NatSpec, similarity
- [OpenAI](https://platform.openai.com) `gpt-4o` for risk analysis (Groq SDK is installed and stubbed as a fallback in [`agent/analyser`](src/agent/analyser.ts), but currently commented out)
- [`@ethersphere/bee-js`](https://github.com/ethersphere/bee-js) signed Swarm feed publishing through the `bzz.limo` gateway with `NULL_STAMP` (no postage batch needed)
- ENS reader + writer (ethers) for `agent.vigilbot.eth` identity records, `demo.vigilbot.eth` ENSIP-11 multichain `addr[base-mainnet]`, an address→name JSON cache, and per-target reputation text records written after every alert (`VIGIL_ENS_NETWORK=sepolia` switches the whole stack to the legacy `vigil.eth` parent for local testing)

### Frontend

- Next.js 16 + React 19 + Tailwind CSS v4
- [wagmi v2](https://wagmi.sh) + [viem](https://viem.sh) + [`@tanstack/react-query`](https://tanstack.com/query) for wallet connection, allowance reads, and `approve(0)` writes
- Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`) for streaming chat
- Recharts for the 24-hour upgrade timeline

## Sponsor Integrations

- **Sourcify** — v2 API for contract verification, storage layout diffing, ABI comparison, NatSpec extraction, and bytecode similarity search across 27M+ verified contracts
- **Apify** — autonomous social context enrichment via X402 micropayments on Base. When an upgrade fires, Vigil pays $1 USDC autonomously to scrape news context — no human in the loop
- **Swarm** — permanent decentralised storage of every alert and block via Mantaray manifest, indexed by block number and accessible via bzz.limo. Permanent feed URL never changes
- **ENS** — agent identity, capability discovery, and per-protocol reputation anchored to vigilbot.eth on Ethereum mainnet
- **Telegram** — real-time alert delivery with AI summary, Swarm link, and Basescan link

## Running locally

Backend:

```bash
npm install
cp .env.example .env       # then fill in keys (see below)
npm run dev                # starts the watcher + pipeline
```

Frontend (in a second terminal):

```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_DEMO_* + optional SWARM_FEED_URL
npm run dev                        # http://localhost:3000
```

The dashboard pulls alerts from (in priority order) the configured Swarm feed URL, the local `data/alerts.json` for Base mainnet, the local `data/alerts-base-sepolia.json` (or an inline TS seed) for Base Sepolia, falling back to mock data when nothing is available. The chain selector toggles which network's alerts are shown. The "live"/"mock" pill in the header reflects the source.

## Deploying on Railway

Vigil ships as **two Railway services** sharing one project / environment:

| Service | Root | Public | Start | Branch |
| --- | --- | --- | --- | --- |
| `Worker` | `/` (repo root) | unexposed (no port, no healthcheck) | `npm start` → `tsx src/agent/index.ts` | `dev` |
| `Web` | `frontend/` | port `8080` (public domain) | `npm start` → `next start` | `dev` |

Railway's Nixpacks/Railpack auto-detects Node and runs `npm ci` for both. No `Dockerfile` or `railway.json` needed.

### Shared variables

Define these once at the **environment** level and reference them from each service via `${{shared.VAR}}`:

| Variable | Worker | Web |
| --- | --- | --- |
| `RPC_URL` | ✅ | — |
| `POLL_INTERVAL_MS` | ✅ | — |
| `OPENAI_API_KEY` | ✅ | ✅ |
| `GROQ_API_KEY` | ✅ | — |
| `SWARM_PRIVATE_KEY` | ✅ | — |
| `SWARM_FEED_URL` | — | ✅ |
| `NEXT_PUBLIC_DEMO_WALLET` | — | ✅ |
| `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY` | — | ✅ |
| `NEXT_PUBLIC_DEMO_SPENDER` | — | ✅ |
| `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA` | — | ✅ |
| `NEXT_PUBLIC_DEMO_PROXY_BASE` | — | ✅ |

### Bootstrapping the Swarm feed URL

The Worker generates its keypair on first boot if `SWARM_PRIVATE_KEY` is unset. To get a stable feed URL the frontend can point to:

1. Deploy the Worker without `SWARM_PRIVATE_KEY`. On startup it prints the generated key + owner address + manifest topic (`vigil-manifest`) hex to **Deploy Logs**.
2. Copy the printed key into the shared var `SWARM_PRIVATE_KEY`. Without this, every restart spawns a fresh owner and subscribers fetch from a stale URL.
3. Build the feed URL — owner from the logs, topic is the deterministic hex of `vigil-manifest` (also printed on every boot):

   ```text
   https://bzz.limo/feeds/<ownerAddress>/<topicHex>
   ```

4. Set that as `SWARM_FEED_URL` on the Web service, **or** publish it to ENS and let the frontend (and any third-party subscriber) discover it via `npm run ens:sync-feed` followed by `npm run ens:resolve agent.vigil.eth`. The agent verifies on boot that `vigil.feed` on ENS matches its actual feed URL and warns loudly when it doesn't.

### Worker checklist

- **Service Type / Networking:** unexposed (no public domain, no healthcheck). The agent is a long-running poller, not an HTTP server — Railway will mark it failed if a healthcheck is enabled.
- **Branch:** `dev` — `main` historically lacked the `npm start` script so the container would crash with `Cannot find module '/app/index.js'`.
- **Logs:** the **Deploy Logs** tab streams the agent's stdout (`[Vigil] Connected to network`, `[UpgradeWatcher] Listening`, `[Swarm] Alert published`, etc.). The **Network Flow Logs** tab is low-level packet captures and not useful for app-level debugging.

## ENS identity (`vigilbot.eth` on Ethereum mainnet)

Vigil's agent and the contracts it watches have human names anchored to **`vigilbot.eth`**, registered on Ethereum mainnet (chain id 1). Subnames carry the agent's runtime configuration and point to the addresses the agent actually watches on **Base mainnet** (chain id 8453) via ENSIP-11 multichain `addr` records.

A Sepolia code path (`vigil.eth` parent, Base Sepolia subnames) is preserved for local testing — opt in with `VIGIL_ENS_NETWORK=sepolia` on both the Worker and the Web service. The active network is selected at runtime by that env var; both default to `mainnet`. The record schema is identical on both networks.

| Subname | Purpose | Records |
| --- | --- | --- |
| `agent.vigil.eth` | Agent identity. Read at boot. | `description`, `url`, `vigil.capabilities` (JSON), `vigil.severity-min`, `vigil.feed` (Swarm subscriber URL), `vigil.payment` |
| `demo.vigil.eth` | Demo proxy that gets live-upgraded during the pitch. | `description`, `vigil.kind=demo-proxy`, `addr[base-sepolia]` (ENSIP-11), and reputation records (see below) |
| `<protocol>.vigil.eth` | Real watched protocols. | same shape as `demo.vigil.eth` |

Three ENS mechanisms do the work:

- **ENSIP-11 multichain address records** — Sepolia subnames carry `addr` records typed for the Base Sepolia coin type (`0x80000000 | 84532 = 2147567180`), so the frontend resolves a name on Sepolia and renders Base Sepolia state. The revoke flow uses this: `RevokeBanner` reads the demo proxy address from `demo.vigil.eth`'s ENSIP-11 record, falling back to `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA` only when ENS resolution is unavailable.
- **ENSIP-19 L2 reverse names** — `demo.vigil.eth` is set as the primary name for the demo proxy on Base Sepolia, so explorers display the human name instead of `0xab…cd`.
- **Reputation text records** — after every alert, the agent writes `vigil.last-severity`, `vigil.last-upgrade-at`, `vigil.last-tx`, and `vigil.upgrade-count` (incremented) to the matching target subname. ENS becomes a live, on-chain reputation log: `npm run ens:resolve usdc.vigil.eth` shows whether Vigil has flagged the protocol recently and how often.

The agent reads `agent.vigil.eth`'s text records at boot, logs the resolved capabilities, and verifies an invariant: the `vigil.feed` URL it advertises on ENS must match the Swarm feed URL it actually publishes to. A mismatch (e.g. `SWARM_PRIVATE_KEY` rotated without re-running `npm run ens:sync-feed`) triggers a loud warning so subscribers don't fetch from a stale URL. If `ETH_SEPOLIA_RPC_URL` is unset, the agent gracefully degrades to legacy mode (no ENS identity, no name tagging, no reputation writes). Address-to-name lookups for tagging alerts use a small JSON cache at [`data/ens-targets.json`](data/) populated by the seed script.

### Subscriber discovery

Other agents and frontends can find Vigil's feed entirely through ENS — no out-of-band URL sharing:

```bash
# 1. Resolve the agent's ENS name to its Swarm feed URL
npm run ens:resolve agent.vigil.eth   # prints vigil.feed: https://bzz.limo/feeds/<owner>/<topic>

# 2. Fetch alerts from the feed (latest)
curl <vigil.feed URL>
```

Reputation lookup is symmetric — `npm run ens:resolve demo.vigil.eth` returns the latest severity, last upgrade timestamp, last tx hash, and total upgrade count Vigil has observed for that target.

### Live deployment (2026-05-09)

**Production — Ethereum mainnet + Base mainnet (`vigilbot.eth`):**

| Record | Chain · address / tx | Notes |
| --- | --- | --- |
| `vigilbot.eth` (registered) | Ethereum mainnet | Production parent. Owner `0xf5B1d9144d9D005CD74cFC2d1A22cbAF4e8E8736`. |
| `demo.vigilbot.eth` proxy | Base mainnet · [`0x91F276F9…6358f`](https://basescan.org/address/0x91F276F98a20d3fBC27e3d8ccE73Ad0e78C6358f) | UUPS proxy used for the live revoke demo. Latest impl + tx history in [`demo-target/DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md#base-mainnet--2026-05-09-active-production-proxy). |
| ENSIP-19 reverse on Base mainnet | Base mainnet · [`0xe8ece43a…ab6561`](https://basescan.org/tx/0xe8ece43a53f14e369557a5ed2c0519a5dfe678bf66c8d67d545d917389ab6561), block 45784174 | Demo proxy → primary name `demo.vigilbot.eth`. L2ReverseRegistrar `0x0000000000D8e504002cC26E3Ec46D81971C1664`. |

**Dev / legacy — Ethereum Sepolia + Base Sepolia (`vigil.eth`):**

| Record | Chain · tx | Notes |
| --- | --- | --- |
| `vigil.eth` (registered + wrapped, 1 year) | Sepolia · [`0x0802bd0d…b15c4f`](https://sepolia.etherscan.io/tx/0x0802bd0daeb44a50588b374a73c685dd6940d699774c1f1436c1807889b15c4f), block 10821165 | Owner `0xf5B1d9144d9D005CD74cFC2d1A22cbAF4e8E8736`. Native NameWrapper wrap as part of `register()`. |
| `agent.vigil.eth` subname + records | Sepolia · [`0xe22e4bd6…ae3b36`](https://sepolia.etherscan.io/tx/0xe22e4bd6a620845cd970f833d2932d8d51371f8b5985eba17250dc9c92ae3b36) | `description`, `url`, `vigil.capabilities` (JSON), `vigil.severity-min=MEDIUM`. |
| `demo.vigil.eth` subname + records | Sepolia · [`0x0b9772fc…605f99`](https://sepolia.etherscan.io/tx/0x0b9772fc952174d42ab798e6e8bec39ca1c5afaf6707c3d05792de9cf1605f99) | `description`, `vigil.kind=demo-proxy`, ENSIP-11 `addr[base-sepolia]` → `0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD`. |
| `vigil.feed` text record | Sepolia · [`0x319da24e…21cee`](https://sepolia.etherscan.io/tx/0x319da24e7cc07f1e78467b6904b35abd6b8798b13343b654a5ee5e2b54521cee) | `agent.vigil.eth → vigil.feed → bzz.limo/feeds/0x4b291F22…/94f6a4be…` for subscriber discovery. |
| `vigil.payment` text record | Sepolia · [`0x648a93a1…fdc5601e`](https://sepolia.etherscan.io/tx/0x648a93a1079fbc18a6a263ff39d2676eda02a8af3907e084ce840e08fdc5601e) | `agent.vigil.eth → vigil.payment → x402:https://api.vigil.app/pay/per-alert`. Discoverable X402 endpoint, stacks with Apify/Umia narratives. |
| ENSIP-19 reverse on Base Sepolia | Base Sepolia · [`0xe5f947d7…dc9093`](https://sepolia.basescan.org/tx/0xe5f947d7a25c28a856492faaa8b53eb8dc14e155c2d10cbf1a0c105602dc9093), block 41284414 | Demo proxy → primary name `demo.vigil.eth`. `setNameForOwnableWithSignature` on L2ReverseRegistrar `0x00000BeEF055f7934784D6d81b6BC86665630dbA`; proxy is `OwnableUpgradeable` so deployer wallet's ERC-191 signature authorizes — no contract change needed. |
| Smoke-test reputation write | Sepolia · 4 setText txs | First populated `demo.vigil.eth` reputation: `vigil.last-severity=CRITICAL`, `vigil.upgrade-count=1`. |
| Run #2 demo upgrade (live e2e replay) | Base Sepolia · [`0x7ee96f68…7b2f7ead`](https://sepolia.basescan.org/tx/0x7ee96f68d31d3b2c6082d67026327b0d669ce8bcbfdf4fcac1eb348a7b2f7ead), block 41287554 | Agent watching Base Sepolia detected `Upgraded(address)`, ran the full pipeline, emitted CRITICAL alert tagged `demo.vigil.eth`, wrote reputation back (count `1→2`). |
| Run #2 latest replayable upgrade | Base Sepolia · [`0x20fbbcf4…6071881`](https://sepolia.basescan.org/tx/0x20fbbcf49dd996f273b1b974ae6fcbe20210a5bf58ad3ce0cb333bb0b6071881), block 41290914, impl [`0x6608a5C1…7cB035`](https://sepolia.basescan.org/address/0x6608a5C1e009fbF0C54aeC491b370Dbe4a7cB035#code) | Bumping `VIGIL_DEMO_BUILD` in `DemoTokenV2.sol` lets `npm run upgrade` (or `npm run demo-cycle`) deploy a fresh impl → new `Upgraded(address)` event the agent picks up, **without** changing the proxy address. Same proxy, replayable demo. Seven prior upgrades archived in [`previousUpgrades`](demo-target/deployments/base-sepolia.json). |

Verify on the ENS app: <https://app.ens.domains/agent.vigil.eth?network=sepolia>

### Re-running setup from scratch

If you ever need to redeploy under a different parent name or against a fresh wallet. **Append `--network=mainnet` to any ENS script for the production parent (`vigilbot.eth` on mainnet); omit for Sepolia (`vigil.eth`).** The same `ENS_REGISTRAR_PRIVATE_KEY` signs both — fund it on whichever network you target.

1. Register the parent. The repo ships an end-to-end script that handles commit-reveal + native NameWrapper wrap in one go. Cost ≈ 0.003 ETH/year for 5+ char names on Sepolia (mainnet pricing varies by name length and premium):

   ```bash
   tsx scripts/ens/check-parent.ts                          # Sepolia (default)
   tsx scripts/ens/check-parent.ts --network=mainnet        # mainnet preflight
   tsx scripts/ens/register-parent.ts --network=mainnet --name=vigilbot.eth
   ```

2. Create subnames + records:

   ```bash
   tsx scripts/ens/seed-subnames.ts                         # Sepolia
   tsx scripts/ens/seed-subnames.ts --network=mainnet       # mainnet (vigilbot.eth)
   ```

3. Publish the agent's Swarm feed URL on the active agent subname so subscribers can discover it. Re-run any time `SWARM_PRIVATE_KEY` rotates:

   ```bash
   tsx scripts/ens/sync-feed.ts                             # Sepolia
   tsx scripts/ens/sync-feed.ts --network=mainnet           # mainnet
   ```

4. (Optional) Bootstrap the feed with a placeholder alert so `vigil.feed` returns parseable JSON to subscribers before the first real upgrade lands:

   ```bash
   tsx scripts/swarm/seed-feed.ts
   ```

5. (Optional) ENSIP-19 reverse on Base. Note this script uses `--network=base-sepolia | base-mainnet` (different from the ENS scripts). Verify the L2 reverse registrar address against <https://docs.ens.domains/learn/deployments>:

   ```bash
   tsx scripts/ens/set-base-primary.ts                              # default base-sepolia
   tsx scripts/ens/set-base-primary.ts --network=base-mainnet
   ```

6. Sanity-check live resolution at any time:

   ```bash
   tsx scripts/ens/resolve.ts agent.vigil.eth
   tsx scripts/ens/resolve.ts --network=mainnet agent.vigilbot.eth
   tsx scripts/ens/resolve.ts --network=mainnet demo.vigilbot.eth
   ```

### Removing ENS breaks the demo (intentional)

The agent reads its identity, capabilities, and severity threshold from `agent.vigil.eth` text records at startup, and tags every alert with the human name from the ENS cache. The frontend renders `demo.vigil.eth (0xab…cd)` instead of bare hex on every alert that has a name. Block explorers display `demo.vigil.eth` via ENSIP-19 reverse resolution. Strip the ENS module out and the agent runs in a noticeably degraded "legacy" mode with bare hex everywhere.

## Driving a demo upgrade

The [`demo-target/`](demo-target/) sub-project deploys an intentionally-vulnerable UUPS proxy on **Base Sepolia** so the agent has an upgrade event to react to on demand. V2 ships three deliberate sins (storage collision, unguarded `drain`, `mint` losing `onlyOwner`) — each one detectable by a different signal in Vigil's pipeline.

> **Status:** end-to-end run #1 completed live on Base Sepolia (2026-05-09). Both implementations are verified on Sourcify and Basescan; the upgrade tx fired the `Upgraded(address)` event Vigil watches for. Addresses recorded in [`demo-target/DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md). Design spec at [`docs/superpowers/specs/2026-05-08-demo-target-design.md`](docs/superpowers/specs/2026-05-08-demo-target-design.md).

Workflow (Base Sepolia by default — append `:mainnet` to any script for Base mainnet):

```bash
cd demo-target
npm install
cp .env.example .env       # DEPLOYER_PRIVATE_KEY + BASE_SEPOLIA_RPC_URL + BASE_MAINNET_RPC_URL
                           # + ETHERSCAN_API_KEY; add DEMO_WALLET_PRIVATE_KEY + DEMO_SPENDER_ADDRESS for seed-demo-wallet
npm run cycle              # Sepolia: reset + deploy V1 + upgrade to V2 in one shot
npm run cycle:mainnet      # Base mainnet equivalent (creates a new proxy — only run for first-time setup)
# or run the steps individually:
npm run deploy             # deploy V1 proxy on Sepolia, verify on Sourcify + Basescan
npm run deploy:mainnet     # same on Base mainnet
npm run seed-demo-wallet   # mint DEMO + approve(spender, MAX) from a separate demo wallet
npm run upgrade            # deploy V2, upgrade proxy — fires Upgraded(address)
npm run upgrade:mainnet    # same on Base mainnet
npm run reset              # wipe Sepolia deployments/ to start from a clean slate
npm run reset:mainnet      # wipe Base mainnet deployments/
```

`ETHERSCAN_API_KEY` is the Etherscan v2 multichain key (one key covers both Base networks). Sourcify verification needs no key. `DEMO_WALLET_PRIVATE_KEY` and `DEMO_SPENDER_ADDRESS` are only needed when running `seed-demo-wallet[:mainnet]` to set up the revoke-on-upgrade demo flow.

Point Vigil's `RPC_URL` at the same Base Sepolia endpoint as the demo target while testing — or use the recorded run #1 addresses to replay the upgrade event without burning gas (see [`DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md#replaying-this-upgrade-in-vigil)).

## Revoke-on-upgrade demo

The marquee demo: a wallet with an active approval on the demo proxy gets a one-click "revoke before exploit" path the moment the malicious V2 upgrade hits.

1. Run `npm run cycle` from [`demo-target/`](demo-target/) to deploy V1 + V2 fresh, then `npm run seed-demo-wallet` to mint DEMO and `approve(DEMO_SPENDER, MAX)` from the demo wallet.
2. Paste the new proxy address into `frontend/.env.local` as `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA`, plus `NEXT_PUBLIC_DEMO_WALLET`, `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY`, and `NEXT_PUBLIC_DEMO_SPENDER`.
3. Open the dashboard and switch the chain selector to **Base Sepolia**. The dashboard reads `allowance(DEMO_WALLET, DEMO_SPENDER)` on every refresh.
4. Trigger the upgrade (`npm run upgrade`). Vigil's pipeline emits a new alert; the matching alert card surfaces a red **"Your wallet is exposed — revoke approval"** banner.
5. Click **Revoke approval**. With no wallet connected, the frontend signs `approve(DEMO_SPENDER, 0)` with the embedded private key and submits via viem — no MetaMask popup. With a wallet connected via the **Connect wallet** button, wagmi routes the tx through it instead. After mining, the banner flips to green **"Approval revoked. Allowance is now 0."**

Implementation in [`RevokeBanner`](frontend/app/components/RevokeBanner.tsx) (UI + orchestration), [`approvals`](frontend/lib/approvals.ts) (allowance hook), and [`wallet`](frontend/lib/wallet.ts) (wagmi config + per-chain demo proxy resolution). Plan: [`docs/plans/2026-05-09-revoke-on-upgrade-mvp.md`](docs/plans/2026-05-09-revoke-on-upgrade-mvp.md).

### Re-arming between pitches

Once V1 is deployed and you've run a pitch through to **Revoke approval** (allowance is now 0), use `demo-cycle` from [`demo-target/`](demo-target/) to reset for the next pitch in one shot:

```bash
cd demo-target
npm run demo-cycle              # Base Sepolia (default)
npm run demo-cycle:mainnet      # Base mainnet (production demo)
```

This bumps the `VIGIL_DEMO_BUILD` constant in `DemoTokenV2.sol` (so the new impl bytecode is unique → fresh `Upgraded` event), deploys a fresh V2 impl, calls `upgradeToAndCall` on the existing proxy, verifies on Sourcify, and re-approves `DEMO_WALLET → DEMO_SPENDER` for `MaxUint256`. End-to-end ≈ 30 s, ≈ 0.0005 ETH on Base Sepolia (mainnet costs more — gas-dependent). Same proxy address across pitches, so ENS records and frontend env vars don't need re-pointing.

Inside Claude Code, the [`demo-cycle` skill](.claude/skills/demo-cycle/SKILL.md) wraps the same script and additionally polls `data/alerts-base-sepolia.json` to confirm the watcher saw the new alert. Trigger it with phrases like "demo cycle", "arm the demo", or "prep the pitch". Spec + plan: [`docs/superpowers/specs/2026-05-09-demo-cycle-design.md`](docs/superpowers/specs/2026-05-09-demo-cycle-design.md), [`docs/superpowers/plans/2026-05-09-demo-cycle.md`](docs/superpowers/plans/2026-05-09-demo-cycle.md).

After running, open the UI on Base Sepolia with **no wallet connected** and the red "Your wallet is exposed" banner reappears on the new alert card.

## Environment variables

Three separate `.env` files — one per sub-project.

### Agent — root [`.env`](.env.example)

Core pipeline:

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Base mainnet (or Base Sepolia for dev) RPC endpoint. |
| `POLL_INTERVAL_MS` | Block poll cadence for the watcher. |
| `OPENAI_API_KEY` | Used by the analyser (`gpt-4o`). |
| `SWARM_PRIVATE_KEY` | 32-byte hex key used to sign the Swarm feed. Auto-generated and printed on first run if missing — copy it back into `.env` to keep the same feed across restarts. |

ENS — read at agent boot and consumed by the ENS scripts:

| Variable | Purpose |
| --- | --- |
| `VIGIL_ENS_NETWORK` | `mainnet` (default) or `sepolia`. Selects which ENS parent the agent reads at boot. `mainnet` reads `vigilbot.eth`; `sepolia` is preserved for local testing only. |
| `ETH_MAINNET_RPC_URL` | Ethereum mainnet RPC. Required for the default `VIGIL_ENS_NETWORK=mainnet` and by `--network=mainnet` script invocations (registration, seeding, reputation writes against `vigilbot.eth`). |
| `ETH_SEPOLIA_RPC_URL` | Ethereum Sepolia RPC. Only required if `VIGIL_ENS_NETWORK=sepolia` or by `--network=sepolia` script invocations. Without it, the agent runs in legacy mode (no name tagging, no severity floor). |
| `VIGIL_PARENT_ENS_NAME` | Defaults to `vigil.eth` (Sepolia parent). |
| `VIGIL_PARENT_ENS_NAME_MAINNET` | Defaults to `vigilbot.eth` (mainnet parent). |
| `VIGIL_AGENT_ENS_NAME` | Defaults to `agent.vigil.eth` (Sepolia agent subname). |
| `VIGIL_AGENT_ENS_NAME_MAINNET` | Defaults to `agent.vigilbot.eth` (mainnet agent subname). |
| `ENS_REGISTRAR_PRIVATE_KEY` | Required by all ENS write scripts (`register-parent`, `seed-subnames`, `set-base-primary`, `sync-feed`). Also enables the agent's per-alert reputation writes — without it, the agent runs read-only. The same key signs both Sepolia and mainnet writes; the wallet must own the parent name on the target network. |
| `BASE_SEPOLIA_RPC_URL` | Used by `set-base-primary --network=base-sepolia`. Defaults to `https://sepolia.base.org`. |
| `BASE_SEPOLIA_PRIVATE_KEY` | Used by `set-base-primary --network=base-sepolia` to sign the ERC-191 message authorising the L2ReverseRegistrar. Must be the deployer (owner) of the demo proxy. |
| `BASE_SEPOLIA_REVERSE_REGISTRAR` | Defaults to `0x00000BeEF055f7934784D6d81b6BC86665630dbA`. Override only if ENS deploys a new address. |
| `BASE_MAINNET_RPC_URL` | Used by `set-base-primary --network=base-mainnet` and the chain-archive backfill utility. |
| `BASE_MAINNET_PRIVATE_KEY` | Used by `set-base-primary --network=base-mainnet`. Falls back to `ENS_REGISTRAR_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` if unset. |

> The committed [`.env.example`](.env.example) still lists `GROQ_API_KEY`, `APIFY_API_KEY`, `SPACECOMPUTER_API_KEY`, `SWARM_BEE_URL`, and `SWARM_POSTAGE_STAMP`. None of those are read by current code — Swarm now publishes to `bzz.limo` with `NULL_STAMP`. The example file is overdue for a clean-up.

### Frontend — [`frontend/.env.local`](frontend/.env.local.example)

| Variable | Purpose |
| --- | --- |
| `SWARM_FEED_URL` | If set, the dashboard fetches the latest alert from this Swarm feed URL on load. Empty disables Swarm and falls back to local files / seed / mock. |
| `VIGIL_ENS_NETWORK` | `mainnet` (default) or `sepolia`. Picks which ENS parent the dashboard resolves identity + reputation against — `mainnet` reads `vigilbot.eth`, `sepolia` is preserved for local testing only. |
| `ETH_MAINNET_RPC_URL` | Server-side only. Required for the default `VIGIL_ENS_NETWORK=mainnet`. Powers the live ENS lookups for the agent identity card and per-alert reputation panels against `vigilbot.eth`. |
| `ETH_SEPOLIA_RPC_URL` | Server-side only. Only required if `VIGIL_ENS_NETWORK=sepolia`. Without an RPC for the active network, the panels degrade gracefully and the dashboard falls back to `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA` for the revoke flow. |
| `OPENAI_API_KEY` | Powers the per-alert chat panel (`gpt-4o-mini`) via the Vercel AI SDK. |
| `NEXT_PUBLIC_DEMO_WALLET` | Address whose allowance the dashboard reads to decide whether to show the revoke banner. |
| `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY` | **Testnet demo only.** Embedded in the frontend bundle so the revoke button can sign `approve(spender, 0)` without a wallet popup. Anyone with devtools can read it — use a dedicated key that holds nothing else. |
| `NEXT_PUBLIC_DEMO_SPENDER` | Address pre-approved on the demo proxy — what the revoke button passes to `approve(_, 0)`. |
| `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA` | Fallback demo proxy address on Base Sepolia. The revoke flow first tries to resolve `demo.vigil.eth`'s ENSIP-11 `addr[base-sepolia]` record and only falls back to this when ENS is unreachable. |
| `NEXT_PUBLIC_DEMO_PROXY_BASE` | Demo proxy address on Base mainnet — intentionally empty until/unless we deploy there. |

### Demo target — [`demo-target/.env`](demo-target/.env.example)

| Variable | Purpose |
| --- | --- |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC. Used by every `npm run *` script without the `:mainnet` suffix. |
| `BASE_MAINNET_RPC_URL` | Base mainnet RPC. Used by every `npm run *:mainnet` variant (`deploy:mainnet`, `upgrade:mainnet`, `demo-cycle:mainnet`, `cycle:mainnet`). |
| `DEPLOYER_PRIVATE_KEY` | Funded EOA used to deploy V1, V2, and the proxy. The same key works on both networks; fund it on whichever you target. |
| `ETHERSCAN_API_KEY` | Etherscan v2 multichain key — one key covers Base Sepolia and Base mainnet (Sourcify needs no key). |
| `DEMO_WALLET_PRIVATE_KEY` | Optional — only required by `seed-demo-wallet[:mainnet]`. Funded EOA whose approval the revoke flow targets. |
| `DEMO_SPENDER_ADDRESS` | Optional — only required by `seed-demo-wallet[:mainnet]`. Address that gets pre-approved for `MaxUint256`. |

## Status

Early WIP. Built for **ETHPrague 2026**.

What works today:

- Live block-by-block watching of EIP-1967 `Upgraded(address)` events
- Sourcify verification (with retries) and bytecode similarity fallback for unverified implementations
- Storage-layout and ABI diffing with severity scoring + sensitive-name flagging + partial-match bump
- OpenAI `gpt-4o` analyser producing structured risk JSON
- Atomic JSON stores per chain ([`data/alerts.json`](data/), `data/alerts-base-sepolia.json`) with deduplication by `txHash` and `chainId` tagging
- Single Mantaray manifest on Swarm holding `blocks/<n>` paths, persisted across restarts via a signed feed (topic `vigil-manifest`, `NULL_STAMP`, `bzz.limo` gateway, no postage batch needed)
- Next.js dashboard with alert list, 24h upgrades chart, severity stats, copy-to-clipboard, per-alert AI chat, **Base/Base-Sepolia chain selector**, and Swarm-feed-URL alert source (cream/navy theme; logo at [`frontend/public/vigil-logo.png`](frontend/public/vigil-logo.png))
- **Revoke-on-upgrade banner** with dual signing: routes through a connected injected wallet via wagmi when one is present, or falls back to a viem `walletClient` signing with the embedded testnet `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY` for hands-off demo runs
- **Optional Connect wallet button** (wagmi `injected()` connector) — the dashboard accepts an external wallet for the revoke flow and shows the demo wallet pill until one is connected
- **ENS identity + reputation** anchored to `vigilbot.eth` on Ethereum mainnet (the legacy `vigil.eth` Sepolia parent is preserved as a code path for local testing via `VIGIL_ENS_NETWORK=sepolia`). Agent reads `agent.vigilbot.eth` at boot for capabilities, severity floor, and `vigil.feed` URL invariant; tags every alert with the resolved human name from a JSON cache; writes 4 reputation text records (`vigil.last-severity`, `vigil.last-upgrade-at`, `vigil.last-tx`, `vigil.upgrade-count`) back to the matching target subname after each alert; and publishes the Swarm subscriber URL on ENS for discovery. ENS lifecycle scripts (`check-parent`, `register-parent`, `seed-subnames`, `set-base-primary`, `sync-feed`, `resolve`) all take `--network=sepolia|mainnet`; Base reverse-naming uses `--network=base-sepolia|base-mainnet`. Live deployment recorded in the [ENS section](#ens-identity-vigilboteth-on-ethereum-mainnet).
- **Dashboard ENS surfacing**: header card resolves `agent.vigil.eth` live from Sepolia ENS (description, capabilities chips, severity-floor pill, `vigil.feed` URL); each alert card embeds an `EnsReputationPanel` showing `last-severity`, `upgrade-count`, and `last-upgrade-at` for the matching subname. Both fetched server-side via viem in [`frontend/lib/ens.ts`](frontend/lib/ens.ts).
- **ENSIP-11 demo proxy resolution**: `RevokeBanner` reads the demo proxy address from `demo.vigil.eth`'s `addr[base-sepolia]` record at request time; `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA` is now a fallback for environments without `ETH_SEPOLIA_RPC_URL`.
- `demo-target/` UUPS proxy with V1/V2 contracts, `deploy` / `upgrade` / `reset` / `cycle` / `seed-demo-wallet` scripts, dual Sourcify + Basescan verification, live-tested on Base Sepolia (run #1 addresses in [`demo-target/DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md))

In progress / not yet wired:

- LangChain (in `package.json` but no imports in `src/`)
- Root [`.env.example`](.env.example) is overdue for a clean-up — `GROQ_API_KEY`, `APIFY_API_KEY`, `SPACECOMPUTER_API_KEY`, `SWARM_BEE_URL`, and `SWARM_POSTAGE_STAMP` are listed but not consumed by current code
- Base mainnet demo proxy (`NEXT_PUBLIC_DEMO_PROXY_BASE`) intentionally empty — revoke flow is Sepolia-only by design

## License

See [LICENSE](./LICENSE).
