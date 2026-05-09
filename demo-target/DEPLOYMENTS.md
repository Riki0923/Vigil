# Live test deployments

Reference for end-to-end live deploys + upgrades on **Base Sepolia** (chainId `84532`). Use these addresses to replay-test Vigil's watcher without burning gas on a fresh `npm run cycle`.

## Run #2 — 2026-05-09 (active proxy, ENS-named)

This is the proxy currently named `demo.vigil.eth` via ENSIP-19 reverse on Base Sepolia and pointed to by `demo.vigil.eth`'s ENSIP-11 `addr[base-sepolia]` record on Sepolia. Different proxy address than run #1 (a `npm run cycle` was run between them); ENS was seeded against this one.

The latest on-chain `Upgraded(address)` event was forced by adding a `VIGIL_DEMO_BUILD` build-stamp constant to [`contracts/DemoTokenV2.sol`](contracts/DemoTokenV2.sol), which changes the impl bytecode without touching storage layout — so OZ's `prepareUpgrade` deploys a fresh impl each run and the agent sees `newImpl != oldImpl`. Bump that constant any time you need to force a fresh upgrade event without re-running `cycle` (which would change the proxy address and break ENS).

| | Value |
|---|---|
| Proxy | [`0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD`](https://sepolia.basescan.org/address/0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD) (named `demo.vigil.eth`) |
| Latest V2 impl | [`0xAb180BDA73bAd047e7a3bb7cfCBC11d2BcAA553b`](https://sepolia.basescan.org/address/0xAb180BDA73bAd047e7a3bb7cfCBC11d2BcAA553b#code) |
| Latest upgrade tx | [`0x311a9136821a2ed09cc2262da5cbb9623be0795a0e3d29f7dfadfdd8e7865b26`](https://sepolia.basescan.org/tx/0x311a9136821a2ed09cc2262da5cbb9623be0795a0e3d29f7dfadfdd8e7865b26) |
| Latest upgrade block | `41288318` |
| Deployer | `0xf5B1d9144d9D005CD74cFC2d1A22cbAF4e8E8736` |

Earlier upgrades on the same proxy are preserved as `previousUpgrades` in [`deployments/base-sepolia.json`](deployments/base-sepolia.json):

* Block `41287554` — original V2 deploy on this proxy (impl `0x1Ade…c933B`).
* Block `41288243` — idempotent re-upgrade pointing back at the same impl `0x1Ade…c933B`. The agent's `newImpl == oldImpl` guard correctly skips this one.

Latest impl verified on **Sourcify** and **Basescan**.

## Run #1 — 2026-05-09 (superseded — proxy from this run is no longer the active one)

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
