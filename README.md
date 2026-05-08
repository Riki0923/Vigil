# Vigil

> Autonomous agent that watches Ethereum proxy upgrades in real time and flags risky changes within seconds.

Proxy upgrades are one of the most exploited surfaces in DeFi. Auditors are slow, expensive, and asleep at 3 AM. Vigil closes the gap between "an upgrade lands on chain" and "someone qualified looks at it."

## How it works

When an upgrade hits a monitored contract, Vigil:

1. Pulls old and new source from Sourcify
2. Diffs storage layouts, function selectors, and ownership
3. Runs an AI assessment over the diff
4. Computes a severity score (1–5)
5. Publishes a signed alert to a Swarm Feed

Subscribers (protocol teams, DAOs, researchers, other agents) consume the feed and react autonomously.

## Stack

- TypeScript / Node.js
- viem (Ethereum RPC + event subscription)
- Sourcify (verified source + storage layouts)
- Apify SDK + X402 (pay-per-call context scraping)
- Swarm bee-js (signed alert publishing)
- LLM provider (vulnerability assessment)

## Status

Early WIP. Built for ETHPrague 2026.

## License

See [LICENSE](./LICENSE).
