# Vigil Dashboard

Next.js 16 + React 19 + Tailwind v4 dashboard for [Vigil](../README.md). Reads upgrade alerts from the agent (Swarm feed → local JSON → seed → mock fallback), surfaces the agent identity from `agent.vigil.eth`, and renders a one-click revoke banner when a connected wallet has an at-risk approval on an upgraded proxy.

**Supports:** Base mainnet (8453, primary) and Base Sepolia (84532, dev / demo). The chain selector in the header switches the view.

## Run locally

```bash
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_DEMO_*, optional SWARM_FEED_URL, SEPOLIA_RPC_URL, OPENAI_API_KEY
npm install
npm run dev                         # http://localhost:3000
```

See the root [README, Frontend env vars](../README.md#frontend--frontendenvlocal) for the full variable list and the [Revoke-on-upgrade demo](../README.md#revoke-on-upgrade-demo) section for the end-to-end pitch flow.

## Where things live

- `app/page.tsx`, server entry; loads alerts + agent identity + target reputations in parallel.
- `app/components/Dashboard.tsx`, main client view (header, stats, chart, alert list).
- `app/components/RevokeBanner.tsx`, the marquee UX; dual-signs via wagmi or embedded testnet key.
- `app/api/chat/route.ts`, per-alert AI chat (Vercel AI SDK + `gpt-4o-mini`).
- `lib/load-alerts.ts`, alert source priority: Swarm feed → `data/alerts*.json` → seed → mock.
- `lib/ens.ts`, server-side viem ENS resolver (Sepolia) for identity + reputation panels.

## Notes for AI agents

This is **Next.js 16**, APIs and conventions differ from older training data. See [AGENTS.md](AGENTS.md) before editing.
