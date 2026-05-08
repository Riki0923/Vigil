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

data/alerts.json             append-only alert store (gitignored)
docs/                        development plan, pitch, swarm notes
```

## Stack

### Backend

- TypeScript (ESM, NodeNext) on Node.js, run with `tsx`
- [ethers v6](https://docs.ethers.org/) for RPC + event subscription
- [Sourcify v2](https://sourcify.dev) for verified sources, storage layouts, ABIs, NatSpec, similarity
- [OpenAI](https://platform.openai.com) `gpt-4o` for risk analysis (Groq SDK wired as fallback)
- [`@ethersphere/bee-js`](https://github.com/ethersphere/bee-js) for signed Swarm feed publishing
- LangChain core (agent orchestration scaffold)

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

## License

See [LICENSE](./LICENSE).
