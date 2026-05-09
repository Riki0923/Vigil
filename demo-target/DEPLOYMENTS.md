# Live test deployments

Reference for end-to-end live deploys + upgrades on **Base mainnet** (chainId `8453`) and **Base Sepolia** (chainId `84532`). Use these addresses to replay-test Vigil's watcher without burning gas on a fresh `npm run cycle:mainnet` / `npm run cycle`.

## Base mainnet — 2026-05-09 (active production proxy)

This is the proxy currently named `demo.vigilbot.eth` via ENSIP-19 reverse on Base mainnet and pointed to by `demo.vigilbot.eth`'s ENSIP-11 `addr[base-mainnet]` record on Ethereum mainnet (`vigilbot.eth` parent registered the same day).

| | Value |
|---|---|
| Proxy | [`0x91F276F98a20d3fBC27e3d8ccE73Ad0e78C6358f`](https://basescan.org/address/0x91F276F98a20d3fBC27e3d8ccE73Ad0e78C6358f) (named `demo.vigilbot.eth`) |
| V1 impl | [`0x3fCD6c9BD1f6979Fa9294DF6Da7742CBF4a91F82`](https://basescan.org/address/0x3fCD6c9BD1f6979Fa9294DF6Da7742CBF4a91F82#code) |
| First V2 impl | [`0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD`](https://basescan.org/address/0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD#code) |
| Latest V2 impl (post first cycle) | [`0x4B40D42F92fd22fa26a839C8B166D1ACc02dcF1b`](https://basescan.org/address/0x4B40D42F92fd22fa26a839C8B166D1ACc02dcF1b#code) |
| First upgrade tx | [`0xe48d9134c8a6bfa4b4235368a81bea4d29c25f84a20fcb72aa6330a1c313e02a`](https://basescan.org/tx/0xe48d9134c8a6bfa4b4235368a81bea4d29c25f84a20fcb72aa6330a1c313e02a) (block 45783764) |
| Latest upgrade tx | [`0x0c5a9bb41e34cf078eca6df7824c91d88eee84ddb8a38f6aa829b389d4a59f51`](https://basescan.org/tx/0x0c5a9bb41e34cf078eca6df7824c91d88eee84ddb8a38f6aa829b389d4a59f51) (block 45784184) |
| ENSIP-19 reverse tx | [`0xe8ece43a53f14e369557a5ed2c0519a5dfe678bf66c8d67d545d917389ab6561`](https://basescan.org/tx/0xe8ece43a53f14e369557a5ed2c0519a5dfe678bf66c8d67d545d917389ab6561) (block 45784174) |
| Deployer | `0xf5B1d9144d9D005CD74cFC2d1A22cbAF4e8E8736` |
| L2ReverseRegistrar | `0x0000000000D8e504002cC26E3Ec46D81971C1664` |

Both impls verified on **Sourcify** and **Basescan**. To re-arm the demo, run `cd demo-target && npm run demo-cycle:mainnet` — bumps the build stamp, deploys a fresh V2 impl, fires `upgradeToAndCall`, mints DEMO + re-approves DEMO_SPENDER.

## Base Sepolia — legacy / testing

### Run #2 — 2026-05-09 (Sepolia active proxy, ENS-named)

This is the proxy currently named `demo.vigil.eth` via ENSIP-19 reverse on Base Sepolia and pointed to by `demo.vigil.eth`'s ENSIP-11 `addr[base-sepolia]` record on Sepolia. Different proxy address than run #1 (a `npm run cycle` was run between them); ENS was seeded against this one.

The latest on-chain `Upgraded(address)` event was forced by adding a `VIGIL_DEMO_BUILD` build-stamp constant to [`contracts/DemoTokenV2.sol`](contracts/DemoTokenV2.sol), which changes the impl bytecode without touching storage layout — so OZ's `prepareUpgrade` deploys a fresh impl each run and the agent sees `newImpl != oldImpl`. Bump that constant any time you need to force a fresh upgrade event without re-running `cycle` (which would change the proxy address and break ENS).

| | Value |
|---|---|
| Proxy | [`0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD`](https://sepolia.basescan.org/address/0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD) (named `demo.vigil.eth`) |
| Latest V2 impl | [`0x6608a5C1e009fbF0C54aeC491b370Dbe4a7cB035`](https://sepolia.basescan.org/address/0x6608a5C1e009fbF0C54aeC491b370Dbe4a7cB035#code) |
| Latest upgrade tx | [`0x20fbbcf49dd996f273b1b974ae6fcbe20210a5bf58ad3ce0cb333bb0b6071881`](https://sepolia.basescan.org/tx/0x20fbbcf49dd996f273b1b974ae6fcbe20210a5bf58ad3ce0cb333bb0b6071881) |
| Latest upgrade block | `41290914` |
| Deployer | `0xf5B1d9144d9D005CD74cFC2d1A22cbAF4e8E8736` |

Seven earlier upgrades on the same proxy are preserved as `previousUpgrades` in [`deployments/base-sepolia.json`](deployments/base-sepolia.json):

* Block `41287554` — original V2 deploy on this proxy (impl `0x1Ade…c933B`).
* Block `41288243` — idempotent re-upgrade pointing back at the same impl `0x1Ade…c933B`. The agent's `newImpl == oldImpl` guard correctly skips this one.
* Block `41288318` — first build-stamp bump (impl `0xAb180BDA…AA553b`); agent was on Base mainnet at the time so didn't see it.
* Blocks `41289176`, `41290689`, `41290714`, `41290887` — four `npm run demo-cycle` replays, each producing a fresh impl via the build-stamp bump.

Latest impl verified on **Sourcify** and **Basescan**.

### Run #1 — 2026-05-09 (Sepolia, superseded — proxy from this run is no longer the active one)

| | Value |
|---|---|
| Proxy | [`0x3fCD6c9BD1f6979Fa9294DF6Da7742CBF4a91F82`](https://sepolia.basescan.org/address/0x3fCD6c9BD1f6979Fa9294DF6Da7742CBF4a91F82) |
| V1 impl | [`0x35FD6810f336cCD9A32e8E1e539c31A37DF411b4`](https://sepolia.basescan.org/address/0x35FD6810f336cCD9A32e8E1e539c31A37DF411b4#code) |
| V2 impl | [`0xaB5730A43DADc1Cc9101CBF51Da0187B4Cd3707E`](https://sepolia.basescan.org/address/0xaB5730A43DADc1Cc9101CBF51Da0187B4Cd3707E#code) |
| Upgrade tx | [`0xcdf3ef3f1056358b2a49e6a8b5eff1519995bec33c9eb6b2bb0c475bff75abb7`](https://sepolia.basescan.org/tx/0xcdf3ef3f1056358b2a49e6a8b5eff1519995bec33c9eb6b2bb0c475bff75abb7) |
| Upgrade block | `41254777` |
| Deployer | `0xf5B1d9144d9D005CD74cFC2d1A22cbAF4e8E8736` |

Both implementations are verified on **Sourcify** and **Basescan** (Etherscan v2). Sourcify is what Vigil's [`src/sourcify`](../src/sourcify/index.ts) consumer reads.

### Replaying a Sepolia upgrade in Vigil

In [`src/watchers/upgradeWatcher.ts`](../src/watchers/upgradeWatcher.ts), temporarily pin the scan range to the upgrade block, point the agent's `RPC_URL` at Base Sepolia (`https://sepolia.base.org`), and restart. The watcher will surface the same `Upgraded(address)` event the live trigger fired.

```ts
const logs = await provider.getLogs({
  fromBlock: 41254777,
  toBlock: 41254777,
  topics: [UPGRADED_TOPIC],
});
```

Revert the scan range and `RPC_URL` after the test.

### Adding more Sepolia runs

Running `npm run cycle` from `demo-target/` produces a fresh proxy + V1 + V2 each time on Base Sepolia. After each cycle, append a new `### Run #N — YYYY-MM-DD` section under "Base Sepolia — legacy / testing" with the new addresses (read from `demo-target/deployments/base-sepolia.json`).

## Adding more mainnet runs

For the live production proxy, prefer `npm run demo-cycle:mainnet` (re-uses the same proxy, swaps impl) so the ENS records and `demo.vigilbot.eth` reverse name remain stable. A full `npm run cycle:mainnet` will spin up a new proxy and break the existing ENS wiring — only do that if you intentionally want to re-seed.
