# Vigil

> Autonomous agent that watches Ethereum proxy upgrades in real time and flags risky changes within seconds.

Proxy upgrades are one of the most exploited surfaces in DeFi. Auditors are slow, expensive, and asleep at 3 AM. Vigil closes the gap between "an upgrade lands on chain" and "someone qualified looks at it."

## How it works

Vigil watches every block on **Base mainnet** for EIP-1967 `Upgraded(address)` events. When one fires, the pipeline runs:

1. **Detect** — [`upgradeWatcher`](src/watchers/upgradeWatcher.ts) reads the new implementation from the event and the old implementation from the EIP-1967 storage slot at `block - 1`.
2. **Verify** — [`sourcify`](src/sourcify/index.ts) checks Sourcify (with retries), and if unverified, runs a bytecode similarity search to flag possible clones of known contracts.
3. **Diff** — storage layouts ([`diffStorage`](src/sourcify/diffStorage.ts)) and ABIs ([`diffFunctions`](src/sourcify/diffFunctions.ts)) are compared. Moved/removed slots and added/removed/modified functions become risk flags. Sensitive names (`upgradeTo`, `withdraw`, `selfdestruct`, …) bump severity.
4. **Score** — combines storage and function risk into `LOW | MEDIUM | HIGH | CRITICAL`. Partial Sourcify matches bump severity by one.
5. **Analyse** — [`agent/analyser`](src/agent/analyser.ts) sends the diff bundle (plus NatSpec when available) to OpenAI `gpt-4o` and returns a structured `{summary, explanation, recommendation, confidence}` JSON.
6. **Publish** — the alert is logged, appended to [`data/alerts.json`](data/), and signed/published to a Swarm Feed via [`@ethersphere/bee-js`](src/swarm/index.ts) through the `bzz.limo` gateway (no postage stamp required). The block payload is archived under its own topic alongside it.

The frontend pulls alerts from (in order) the configured Swarm feed URL, local `data/alerts.json` for Base mainnet, `data/alerts-base-sepolia.json` (or an inline TS seed) for Base Sepolia, falling back to mock data when nothing is available. A chain selector switches the view between Base and Base Sepolia, and any alert can be opened in a per-alert AI chat grounded in that alert's JSON.

When the configured demo wallet has a non-zero approval on the same proxy that just emitted an upgrade alert, the alert card surfaces a **"Your wallet is exposed — revoke approval"** banner. One click submits `approve(spender, 0)` directly via viem using an embedded testnet private key — no MetaMask popup. (Wagmi is still wired for the optional Connect button, but the revoke flow itself is hands-off so the demo runs without prompting the audience.)

## Repository layout

```text
src/                         backend agent (TypeScript, Node.js, ESM)
├── agent/                   pipeline entrypoint + AI analyser
├── watchers/                EIP-1967 Upgraded event listener
├── sourcify/                verification, storage/ABI diffs, similarity
├── alerts/                  Alert type + severity + console rendering
├── delivery/                logAlert + atomic JSON store (data/alerts.json)
└── swarm/                   bee-js feed publisher (alerts + block archive)

frontend/                    Next.js 16 dashboard (React 19, Tailwind v4)
├── app/page.tsx             thin entry — defers to <Dashboard />
├── app/components/          Dashboard, AlertList, ChatPanel, UpgradesChart,
│                            ChainSelector, ConnectButton, RevokeBanner,
│                            ViewChainContext, Web3Provider, CopyButton
├── app/api/chat/route.ts    streaming AI chat grounded on a single alert
└── lib/                     types, alert loader (Swarm + JSON + seed),
                             wallet config (wagmi/viem), approval hooks,
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

### Frontend

- Next.js 16 + React 19 + Tailwind CSS v4
- [wagmi v2](https://wagmi.sh) + [viem](https://viem.sh) + [`@tanstack/react-query`](https://tanstack.com/query) for wallet connection, allowance reads, and `approve(0)` writes
- Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`) for streaming chat
- Recharts for the 24-hour upgrade timeline

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

1. Deploy the Worker without `SWARM_PRIVATE_KEY`. On startup it prints the generated key + owner address to **Deploy Logs**.
2. Copy the printed key into the shared var `SWARM_PRIVATE_KEY`. Without this, every restart spawns a fresh owner and the frontend's feed URL goes stale.
3. Build the feed URL — owner from the logs, topic is the deterministic hex of `vigil-alerts` (also printed on every boot):

   ```text
   https://bzz.limo/feeds/<ownerAddress>/<topicHex>
   ```

4. Set that as `SWARM_FEED_URL` on the Web service. Railway redeploys, and the dashboard switches from seed/mock data to the live Swarm feed once the agent publishes its first alert.

### Worker checklist

- **Service Type / Networking:** unexposed (no public domain, no healthcheck). The agent is a long-running poller, not an HTTP server — Railway will mark it failed if a healthcheck is enabled.
- **Branch:** `dev` — `main` historically lacked the `npm start` script so the container would crash with `Cannot find module '/app/index.js'`.
- **Logs:** the **Deploy Logs** tab streams the agent's stdout (`[Vigil] Connected to network`, `[UpgradeWatcher] Listening`, `[Swarm] Alert published`, etc.). The **Network Flow Logs** tab is low-level packet captures and not useful for app-level debugging.

## Driving a demo upgrade

The [`demo-target/`](demo-target/) sub-project deploys an intentionally-vulnerable UUPS proxy on **Base Sepolia** so the agent has an upgrade event to react to on demand. V2 ships three deliberate sins (storage collision, unguarded `drain`, `mint` losing `onlyOwner`) — each one detectable by a different signal in Vigil's pipeline.

> **Status:** end-to-end run #1 completed live on Base Sepolia (2026-05-09). Both implementations are verified on Sourcify and Basescan; the upgrade tx fired the `Upgraded(address)` event Vigil watches for. Addresses recorded in [`demo-target/DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md). Design spec at [`docs/superpowers/specs/2026-05-08-demo-target-design.md`](docs/superpowers/specs/2026-05-08-demo-target-design.md).

Workflow:

```bash
cd demo-target
npm install
cp .env.example .env       # DEPLOYER_PRIVATE_KEY (funded on Base Sepolia) + RPC_URL + ETHERSCAN_API_KEY
                           # Add DEMO_WALLET_PRIVATE_KEY + DEMO_SPENDER_ADDRESS for seed-demo-wallet
npm run cycle              # reset + deploy V1 + upgrade to V2 in one shot
# or run the steps individually:
npm run deploy             # deploy V1 proxy, verify on Sourcify + Basescan
npm run seed-demo-wallet   # mint DEMO + approve(spender, MAX) from a separate demo wallet
npm run upgrade            # deploy V2, upgrade proxy, verify — fires Upgraded(address)
npm run reset              # wipe deployments/ to start from a clean slate
```

`ETHERSCAN_API_KEY` is the Etherscan v2 multichain key (one key covers Base Sepolia and others). Sourcify verification needs no key. `DEMO_WALLET_PRIVATE_KEY` and `DEMO_SPENDER_ADDRESS` are only needed when running `seed-demo-wallet` to set up the revoke-on-upgrade demo flow.

Point Vigil's `RPC_URL` at the same Base Sepolia endpoint as the demo target while testing — or use the recorded run #1 addresses to replay the upgrade event without burning gas (see [`DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md#replaying-this-upgrade-in-vigil)).

## Revoke-on-upgrade demo

The marquee demo: a wallet with an active approval on the demo proxy gets a one-click "revoke before exploit" path the moment the malicious V2 upgrade hits.

1. Run `npm run cycle` from [`demo-target/`](demo-target/) to deploy V1 + V2 fresh, then `npm run seed-demo-wallet` to mint DEMO and `approve(DEMO_SPENDER, MAX)` from the demo wallet.
2. Paste the new proxy address into `frontend/.env.local` as `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA`, plus `NEXT_PUBLIC_DEMO_WALLET`, `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY`, and `NEXT_PUBLIC_DEMO_SPENDER`.
3. Open the dashboard and switch the chain selector to **Base Sepolia**. The dashboard reads `allowance(DEMO_WALLET, DEMO_SPENDER)` on every refresh.
4. Trigger the upgrade (`npm run upgrade`). Vigil's pipeline emits a new alert; the matching alert card surfaces a red **"Your wallet is exposed — revoke approval"** banner.
5. Click **Revoke approval**. The frontend signs `approve(DEMO_SPENDER, 0)` with the embedded private key and submits via viem — no MetaMask popup. After mining, the banner flips to green **"Approval revoked. Allowance is now 0."**

Implementation in [`RevokeBanner`](frontend/app/components/RevokeBanner.tsx) (UI + orchestration), [`approvals`](frontend/lib/approvals.ts) (allowance hook), and [`wallet`](frontend/lib/wallet.ts) (wagmi config + per-chain demo proxy resolution). Plan: [`docs/plans/2026-05-09-revoke-on-upgrade-mvp.md`](docs/plans/2026-05-09-revoke-on-upgrade-mvp.md).

## Environment variables

Three separate `.env` files — one per sub-project.

### Agent — root [`.env`](.env.example)

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Base mainnet (or Base Sepolia for dev) RPC endpoint. |
| `POLL_INTERVAL_MS` | Block poll cadence for the watcher. |
| `OPENAI_API_KEY` | Used by the analyser (`gpt-4o`). |
| `SWARM_PRIVATE_KEY` | 32-byte hex key used to sign the Swarm feed. Auto-generated and printed on first run if missing — copy it back into `.env` to keep the same feed across restarts. |

> The committed [`.env.example`](.env.example) still lists `GROQ_API_KEY`, `APIFY_API_KEY`, `SPACECOMPUTER_API_KEY`, `SWARM_BEE_URL`, and `SWARM_POSTAGE_STAMP`. None of those are read by current code — Swarm now publishes to `bzz.limo` with `NULL_STAMP`. The example file is overdue for a clean-up.

### Frontend — [`frontend/.env.local`](frontend/.env.local.example)

| Variable | Purpose |
| --- | --- |
| `SWARM_FEED_URL` | If set, the dashboard fetches the latest alert from this Swarm feed URL on load. Empty disables Swarm and falls back to local files / seed / mock. |
| `OPENAI_API_KEY` | Powers the per-alert chat panel (`gpt-4o-mini`) via the Vercel AI SDK. |
| `NEXT_PUBLIC_DEMO_WALLET` | Address whose allowance the dashboard reads to decide whether to show the revoke banner. |
| `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY` | **Testnet demo only.** Embedded in the frontend bundle so the revoke button can sign `approve(spender, 0)` without a wallet popup. Anyone with devtools can read it — use a dedicated key that holds nothing else. |
| `NEXT_PUBLIC_DEMO_SPENDER` | Address pre-approved on the demo proxy — what the revoke button passes to `approve(_, 0)`. |
| `NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA` | Demo proxy address on Base Sepolia (from `demo-target` deploy). |
| `NEXT_PUBLIC_DEMO_PROXY_BASE` | Demo proxy address on Base mainnet — intentionally empty until/unless we deploy there. |

### Demo target — [`demo-target/.env`](demo-target/.env.example)

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Base Sepolia RPC. Match the agent's RPC if you want Vigil's watcher to see the deploy. |
| `DEPLOYER_PRIVATE_KEY` | Funded Base Sepolia EOA used to deploy V1, V2, and the proxy. |
| `ETHERSCAN_API_KEY` | Etherscan v2 multichain key for Basescan verification (Sourcify needs no key). |
| `DEMO_WALLET_PRIVATE_KEY` | Optional — only required by `seed-demo-wallet`. Funded Base Sepolia EOA whose approval the revoke flow targets. |
| `DEMO_SPENDER_ADDRESS` | Optional — only required by `seed-demo-wallet`. Address that gets pre-approved for `MaxUint256`. |

## Status

Early WIP. Built for **ETHPrague 2026**.

What works today:

- Live block-by-block watching of EIP-1967 `Upgraded(address)` events
- Sourcify verification (with retries) and bytecode similarity fallback for unverified implementations
- Storage-layout and ABI diffing with severity scoring + sensitive-name flagging + partial-match bump
- OpenAI `gpt-4o` analyser producing structured risk JSON
- Atomic JSON stores per chain ([`data/alerts.json`](data/), `data/alerts-base-sepolia.json`) with deduplication by `txHash` and `chainId` tagging
- Signed Swarm feed publishing for alerts and full block payloads through the `bzz.limo` gateway (`NULL_STAMP`, no postage batch needed)
- Next.js dashboard with alert list, 24h upgrades chart, severity stats, copy-to-clipboard, per-alert AI chat, **Base/Base-Sepolia chain selector**, and Swarm-feed-URL alert source (cream/navy theme; logo at [`frontend/public/vigil-logo.png`](frontend/public/vigil-logo.png))
- **Revoke-on-upgrade banner**: when an alert matches a demo proxy and the configured demo wallet has a non-zero approval, one click signs `approve(spender, 0)` via viem using an embedded testnet private key — no MetaMask popup
- `demo-target/` UUPS proxy with V1/V2 contracts, `deploy` / `upgrade` / `reset` / `cycle` / `seed-demo-wallet` scripts, dual Sourcify + Basescan verification, live-tested on Base Sepolia (run #1 addresses in [`demo-target/DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md))

In progress / not yet wired:

- LangChain (in `package.json` but no imports in `src/`)
- Root [`.env.example`](.env.example) is overdue for a clean-up — `GROQ_API_KEY`, `APIFY_API_KEY`, `SPACECOMPUTER_API_KEY`, `SWARM_BEE_URL`, and `SWARM_POSTAGE_STAMP` are listed but not consumed by current code
- Base mainnet demo proxy (`NEXT_PUBLIC_DEMO_PROXY_BASE`) intentionally empty — revoke flow is Sepolia-only by design

## License

See [LICENSE](./LICENSE).
