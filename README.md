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
6. **Publish** — the alert is logged, appended to [`data/alerts.json`](data/), and (if a Swarm postage stamp is configured) signed and published to a Swarm Feed via [`@ethersphere/bee-js`](src/swarm/index.ts). The block payload is archived alongside it.

The frontend reads the same `data/alerts.json` (falling back to mock data if empty) and lets users click any alert to chat with a per-alert assistant grounded in that alert's JSON.

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
├── app/page.tsx             alert list, stats, 24h upgrades chart
├── app/components/          AlertList, ChatPanel, UpgradesChart, …
├── app/api/chat/route.ts    streaming AI chat grounded on a single alert
└── lib/                     types, alert loader, formatters, mock data

demo-target/                 Hardhat sub-project — intentionally-vulnerable
                             UUPS proxy on Base Sepolia for driving demos
├── contracts/               DemoTokenV1.sol + DemoTokenV2.sol (3 deliberate sins)
├── scripts/                 deploy-proxy, trigger-upgrade, reset
├── deployments/             per-network JSON written by deploy-proxy (gitignored)
└── DEPLOYMENTS.md           live test addresses + replay instructions

data/alerts.json             append-only alert store (gitignored)
docs/                        development plan, pitch, swarm notes, specs
```

## Stack

### Backend

- TypeScript (ESM, NodeNext) on Node.js, run with `tsx`
- [ethers v6](https://docs.ethers.org/) for RPC + event subscription
- [Sourcify v2](https://sourcify.dev) for verified sources, storage layouts, ABIs, NatSpec, similarity
- [OpenAI](https://platform.openai.com) `gpt-4o` for risk analysis (Groq SDK is installed and stubbed as a fallback in [`agent/analyser`](src/agent/analyser.ts), but currently commented out)
- [`@ethersphere/bee-js`](https://github.com/ethersphere/bee-js) for signed Swarm feed publishing

### Frontend

- Next.js 16 + React 19 + Tailwind CSS v4
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
npm run dev                # http://localhost:3000
```

The dashboard reads `../data/alerts.json` directly. Until the agent emits its first alert, the page renders mock data with a "showing mock data" badge.

## Driving a demo upgrade

The [`demo-target/`](demo-target/) sub-project deploys an intentionally-vulnerable UUPS proxy on **Base Sepolia** so the agent has an upgrade event to react to on demand. V2 ships three deliberate sins (storage collision, unguarded `drain`, `mint` losing `onlyOwner`) — each one detectable by a different signal in Vigil's pipeline.

> **Status:** end-to-end run #1 completed live on Base Sepolia (2026-05-09). Both implementations are verified on Sourcify and Basescan; the upgrade tx fired the `Upgraded(address)` event Vigil watches for. Addresses recorded in [`demo-target/DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md). Design spec at [`docs/superpowers/specs/2026-05-08-demo-target-design.md`](docs/superpowers/specs/2026-05-08-demo-target-design.md).

Workflow:

```bash
cd demo-target
npm install
cp .env.example .env       # DEPLOYER_PRIVATE_KEY (funded on Base Sepolia) + RPC_URL + ETHERSCAN_API_KEY
npm run cycle              # reset + deploy V1 + upgrade to V2 in one shot
# or run the steps individually:
npm run deploy             # deploy V1 proxy, verify on Sourcify + Basescan
npm run upgrade            # deploy V2, upgrade proxy, verify — fires Upgraded(address)
npm run reset              # wipe deployments/ to start from a clean slate
```

`ETHERSCAN_API_KEY` is the Etherscan v2 multichain key (one key covers Base Sepolia and others). Sourcify verification needs no key.

Point Vigil's `RPC_URL` at the same Base Sepolia endpoint as the demo target while testing — or use the recorded run #1 addresses to replay the upgrade event without burning gas (see [`DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md#replaying-this-upgrade-in-vigil)).

## Environment variables

See [`.env.example`](.env.example). Required to actually run the full pipeline:

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | Base mainnet RPC (Alchemy/Infura). Sepolia works for dev. |
| `POLL_INTERVAL_MS` | Block poll cadence for the watcher. |
| `OPENAI_API_KEY` | Used by the analyser (`gpt-4o`) and the frontend chat (`gpt-4o-mini`). |
| `GROQ_API_KEY` | Optional fallback LLM provider. |
| `SWARM_BEE_URL` | Bee node endpoint. Defaults to `https://bee-api.ethswarm.org`. |
| `SWARM_POSTAGE_STAMP` | Postage batch ID. Without it, alerts are still logged + stored locally but not published to Swarm. |
| `SWARM_PRIVATE_KEY` | 32-byte hex key used to sign the alert feed. Auto-generated and printed on first run if missing — copy it back into `.env` to keep the same feed across restarts. |

## Status

Early WIP. Built for **ETHPrague 2026**.

What works today:

- Live block-by-block watching of EIP-1967 `Upgraded(address)` events
- Sourcify verification (with retries) and bytecode similarity fallback for unverified implementations
- Storage-layout and ABI diffing with severity scoring + sensitive-name flagging + partial-match bump
- OpenAI `gpt-4o` analyser producing structured risk JSON
- Atomic JSON store at [`data/alerts.json`](data/), with deduplication by `txHash`
- Signed Swarm feed publishing for both alerts and full block payloads (when a postage stamp is configured)
- Next.js dashboard with alert list, 24h upgrades chart, severity stats, copy-to-clipboard, and per-alert AI chat (cream/navy theme; Vigil logo at [`frontend/public/vigil-logo.png`](frontend/public/vigil-logo.png))
- `demo-target/` UUPS proxy with V1/V2 contracts, `deploy` / `upgrade` / `reset` / `cycle` scripts, dual Sourcify + Basescan verification, live-tested on Base Sepolia (run #1 addresses in [`demo-target/DEPLOYMENTS.md`](demo-target/DEPLOYMENTS.md))

In progress / not yet wired:

- LangChain (in `package.json` but no imports in `src/`)
- Apify / SpaceComputer keys appear in [`.env.example`](.env.example) but are not consumed by any code yet

## License

See [LICENSE](./LICENSE).
