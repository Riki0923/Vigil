# Live test deployments

Reference for the first end-to-end live deploy + upgrade on **Base Sepolia** (chainId `84532`). Use these addresses to replay-test Vigil's watcher without burning gas on a fresh `npm run cycle`.

## Run #1 — 2026-05-09

| | Value |
|---|---|
| Proxy | [`0x3fCD6c9BD1f6979Fa9294DF6Da7742CBF4a91F82`](https://sepolia.basescan.org/address/0x3fCD6c9BD1f6979Fa9294DF6Da7742CBF4a91F82) |
| V1 impl | [`0x35FD6810f336cCD9A32e8E1e539c31A37DF411b4`](https://sepolia.basescan.org/address/0x35FD6810f336cCD9A32e8E1e539c31A37DF411b4#code) |
| V2 impl | [`0xaB5730A43DADc1Cc9101CBF51Da0187B4Cd3707E`](https://sepolia.basescan.org/address/0xaB5730A43DADc1Cc9101CBF51Da0187B4Cd3707E#code) |
| Upgrade tx | [`0xcdf3ef3f1056358b2a49e6a8b5eff1519995bec33c9eb6b2bb0c475bff75abb7`](https://sepolia.basescan.org/tx/0xcdf3ef3f1056358b2a49e6a8b5eff1519995bec33c9eb6b2bb0c475bff75abb7) |
| Upgrade block | `41254777` |
| Deployer | `0xf5B1d9144d9D005CD74cFC2d1A22cbAF4e8E8736` |

Both implementations are verified on **Sourcify** and **Basescan** (Etherscan v2). Sourcify is what Vigil's [`src/sourcify`](../src/sourcify/index.ts) consumer reads.

## Replaying this upgrade in Vigil

In [`src/watchers/upgradeWatcher.ts`](../src/watchers/upgradeWatcher.ts), temporarily pin the scan range to the upgrade block, point the agent's `RPC_URL` at Base Sepolia (`https://sepolia.base.org`), and restart. The watcher will surface the same `Upgraded(address)` event the live trigger fired.

```ts
const logs = await provider.getLogs({
  fromBlock: 41254777,
  toBlock: 41254777,
  topics: [UPGRADED_TOPIC],
});
```

Revert the scan range and `RPC_URL` after the test.

## Adding more runs

Running `npm run cycle` from `demo-target/` produces a fresh proxy + V1 + V2 each time. After each cycle, append a new `## Run #N — YYYY-MM-DD` section above with the new addresses (read from `demo-target/deployments/base-sepolia.json`).
