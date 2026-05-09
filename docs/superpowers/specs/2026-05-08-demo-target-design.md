# Demo target — upgradeable proxy for Vigil testing

**Date:** 2026-05-08
**Owner:** J (0xj4an)
**Status:** Spec, awaiting review
**Related:** [docs/development_plan.md](../../development_plan.md) — Day 1 J task: "Deploy DemoProxy.sol to Base Sepolia. Trigger script in scripts/trigger-upgrade.ts."

## Goal

Provide Vigil with a controllable, intentionally-vulnerable upgrade event on Base Sepolia. Running `trigger-upgrade` must:

1. Fire an EIP-1967 `Upgraded(address)` event that Vigil's [src/watchers/upgradeWatcher.ts](../../../src/watchers/upgradeWatcher.ts) detects within one poll interval.
2. Point the proxy at a V2 implementation that contains three distinct, demo-legible vulnerabilities — enough that the differ + AI assessor on Day 2 can produce a confident severity-4+ alert without prompt-tuning.
3. Have both V1 and V2 implementations verified on Sourcify so [src/sourcify/index.ts](../../../src/sourcify/index.ts) can fetch source and storage layout.

This is a testing artifact, not product. It is not part of the Vigil runtime — it sits in its own sub-project so its deploy-time deps don't pollute the agent's `package.json` or `node_modules`.

## Non-goals

- Real token economics, multi-user flows, or anything resembling a production token.
- Generic upgrade scaffolding for arbitrary contracts. This is one specific demo target.
- Mainnet deploy paths. Base Sepolia only.
- Multiple proxy patterns. UUPS only.
- Beacon proxies, Diamond pattern, or non-OpenZeppelin upgrade libraries.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Proxy pattern | **UUPS** | One impl contract to verify on Sourcify (Transparent needs ProxyAdmin too); upgrade auth lives in the implementation, giving the differ an extra detection path on Day 2 if `_authorizeUpgrade` access weakens; modern protocol convention. Resolves [development_plan.md](../../development_plan.md) open question #4. |
| Tooling | **Hardhat + `@openzeppelin/hardhat-upgrades`** | Existing repo is Node/TS. Hardhat keeps deploy in the same toolchain as the agent. The OZ plugin handles ERC-1967 proxy mechanics, storage-layout safety checks, and the `unsafeSkipStorageCheck` escape hatch we need to *intentionally* ship a colliding upgrade. |
| Verification | **Sourcify** (via `hardhat-verify`) | No API key needed; matches Vigil's existing Sourcify consumer. Both V1 and V2 implementations are verified; the proxy is not (Vigil only diffs implementations). |
| Demo contract | **Tiny ERC20-flavored token** | Smallest surface that yields three distinct, legible vulnerabilities. No funding step needed before demo (vault would require deposits). |
| Vulnerability mix | **All three: storage collision + backdoor + access loss** | Maximum demo signal — assessor lands severity 5 confidently, and we can pick which vuln to emphasize live based on audience reaction. |
| Folder location | **`demo-target/` (repo-root sub-project)** | Self-contained — its own `package.json` and `node_modules`. Avoids mixing Solidity deploy-time deps into the agent runtime. Named for role (Vigil's target during the demo) so the layout doesn't suggest it's part of the agent. |

## Layout

```
Vigil/
├─ src/                       # existing — Vigil agent (untouched by this work)
├─ docs/
└─ demo-target/               # new — self-contained Hardhat project
   ├─ contracts/
   │  ├─ DemoTokenV1.sol
   │  └─ DemoTokenV2.sol
   ├─ scripts/
   │  ├─ deploy-proxy.ts
   │  └─ trigger-upgrade.ts
   ├─ deployments/
   │  └─ base-sepolia.json    # gitignored — proxy + impl addresses, written by deploy-proxy
   ├─ hardhat.config.ts
   ├─ package.json            # own deps; not the agent's
   ├─ tsconfig.json
   ├─ .env                    # gitignored — DEPLOYER_PRIVATE_KEY, RPC_URL
   └─ .env.example
```

`demo-target/` is its own npm project. No workspaces config — installs are independent (`cd demo-target && npm install`). The agent's existing `package.json` is not touched.

## Components

### `DemoTokenV1.sol`

UUPS-upgradeable ERC20.

**Inheritance:** `Initializable`, `ERC20Upgradeable`, `OwnableUpgradeable`, `UUPSUpgradeable` (all from `@openzeppelin/contracts-upgradeable`).

**State (added on top of OZ parents):**
- `bool public paused;`
- `uint256 public mintCap;`

**Functions:**
- `initialize(address owner, uint256 initialSupply, uint256 _mintCap)` — `initializer`-gated. Calls parent `__ERC20_init("DemoToken", "DEMO")`, `__Ownable_init(owner)`, `__UUPSUpgradeable_init()`. Mints `initialSupply` to `owner`. Sets `mintCap = _mintCap`.
- `mint(address to, uint256 amount) external onlyOwner` — reverts if `paused` or `totalSupply() + amount > mintCap`.
- `pause() external onlyOwner` — sets `paused = true`.
- `_authorizeUpgrade(address) internal override onlyOwner` — UUPS auth hook.

**Constructor:** `constructor() { _disableInitializers(); }` — required by OZ for upgradeable contracts.

### `DemoTokenV2.sol`

Same inheritance as V1. Three deliberate sins, each detectable by a different Vigil signal on Day 2:

1. **Storage slot collision** — declares `address public emergencyAdmin;` as the *first* state var (before `paused` and `mintCap`). This shifts the slot offsets of `paused` and `mintCap` by one. Post-upgrade, reads of `paused` actually read the slot now occupied by `emergencyAdmin`. The OZ storage-layout JSON exposed via Sourcify makes this collision diff-able by Vigil's storage-layout differ.

2. **Hidden backdoor** — adds `drain(address victim, uint256 amount) external` with **no access modifier**. Internally: `_burn(victim, amount); _mint(msg.sender, amount);`. Anyone can transfer any balance to themselves. Detected by source diff + AI assessor.

3. **Access-control loss** — `mint` loses its `onlyOwner` modifier. Anyone can mint up to `mintCap` to any address. Detected by source diff (modifier removed on a public function) and AI assessor.

`_authorizeUpgrade` stays `onlyOwner`. We do not weaken upgrade auth in V2 — it's not needed for the three vulnerabilities and keeps the demo's blast radius bounded.

`mintCap` retains the same V1 enforcement in `mint`, so the access-loss vuln is bounded but still demo-worthy ("anyone can mint up to the cap").

### `scripts/deploy-proxy.ts`

Reads `DEPLOYER_PRIVATE_KEY` and `RPC_URL` from `demo-target/.env`. Steps:

1. If `deployments/base-sepolia.json` exists, log addresses and exit (idempotent).
2. `upgrades.deployProxy(DemoTokenV1, [deployer.address, parseEther("1000"), parseEther("1000000")], { kind: "uups" })` — deploys V1 impl + ERC-1967 proxy, calls `initialize`.
3. Read implementation address via `upgrades.erc1967.getImplementationAddress(proxyAddr)`.
4. Write `{ proxyAddress, v1ImplAddress, deployedAt, blockNumber }` to `deployments/base-sepolia.json`.
5. Verify V1 implementation on Sourcify via `hardhat-verify`.
6. Print proxy address (this is what Vigil will watch).

### `scripts/trigger-upgrade.ts`

Reads addresses from `deployments/base-sepolia.json`. Steps:

1. Error out clearly if the deployments file is missing — surface "run deploy-proxy first" in plain words.
2. `upgrades.upgradeProxy(proxyAddr, DemoTokenV2, { kind: "uups", unsafeSkipStorageCheck: true })` — the flag is **required** because OZ's safety check would otherwise refuse the colliding layout. That refusal is the bug we are deliberately recreating.
3. Read new impl address. Append `{ v2ImplAddress, upgradedAt, upgradeTxHash, upgradeBlockNumber }` to `deployments/base-sepolia.json`.
4. Verify V2 implementation on Sourcify.
5. Print the upgrade tx hash so we can confirm the `Upgraded(address)` event fired.

The script is re-runnable: re-running after a successful upgrade should detect that V2 is already current and exit with a clear message. (For demo recovery: deleting `deployments/base-sepolia.json` and starting over from `deploy-proxy.ts` is the supported "reset" path — no separate reset script needed.)

### `hardhat.config.ts`

- Solidity 0.8.24, optimizer on (`runs: 200`).
- Networks: `baseSepolia` (chainId 84532, url from `RPC_URL`, accounts from `DEPLOYER_PRIVATE_KEY`).
- Sourcify enabled in `sourcify` config block; Etherscan disabled (no key, not needed).
- Plugins: `@nomicfoundation/hardhat-toolbox`, `@openzeppelin/hardhat-upgrades`.

### `.env.example`

```
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
DEPLOYER_PRIVATE_KEY=0x...
```

The deployer wallet must hold a small amount of Base Sepolia ETH (publicly available faucet). Funding the wallet is a manual prereq, not part of the script — calling out in `demo-target/README.md`.

## Data flow (the critical paths)

**Deploy:**
```
deploy-proxy.ts
  → hardhat-upgrades.deployProxy(V1, [owner, supply, cap], { kind: 'uups' })
  → ERC1967Proxy bytecode + V1 impl deployed
  → initialize() called atomically via deployProxy
  → write deployments/base-sepolia.json
  → hardhat-verify pushes V1 impl source to Sourcify
```

**Trigger (the demo moment):**
```
trigger-upgrade.ts
  → hardhat-upgrades.upgradeProxy(proxyAddr, V2, { unsafeSkipStorageCheck: true })
  → V2 impl deployed
  → proxy.upgradeToAndCall(V2impl, "0x") executed
  → EIP-1967 Upgraded(address) event emitted on the PROXY's address
  → Vigil's upgradeWatcher.ts sees the log within one POLL_INTERVAL_MS
  → processUpgrade() invoked with proxy + V2impl addresses
  → src/sourcify queries Sourcify for V2impl source → finds it (verified by trigger-upgrade)
  → (Day 2) differ produces collision + access-loss + backdoor signals
  → (Day 2) assessor returns severity 4+
```

## Edge cases & failure modes

| Case | Behavior |
|---|---|
| Run `deploy-proxy` twice | Second run reads existing `deployments/base-sepolia.json`, prints addresses, exits 0. |
| Run `trigger-upgrade` before `deploy-proxy` | Errors with "no deployments/base-sepolia.json — run npm run deploy first". Exit non-zero. |
| Run `trigger-upgrade` twice | Second run detects V2 already current, prints addresses + tx hash, exits 0. |
| `unsafeSkipStorageCheck` accidentally omitted | OZ plugin throws on storage layout incompatibility. Fail loud. The flag is required and should be set in the script — this case only happens if someone edits the script. |
| Sourcify verification fails (network blip) | Deploy succeeds; verification logged as a warning. Re-run verification manually via `npx hardhat verify --network baseSepolia <addr>`. |
| Deployer wallet has insufficient gas | Hardhat surfaces the RPC error. Fund the wallet from a Base Sepolia faucet and retry. |
| Vigil's watcher misses the event (RPC blip) | Re-trigger by running `trigger-upgrade` again after first re-deploying V1 (drop `deployments/base-sepolia.json`, re-deploy). Faster path: temporarily set Vigil's `fromBlock` to the upgrade block to replay (already a documented Vigil debug technique). |
| `POLL_INTERVAL_MS=30000` (current default) | Vigil sees the event within 30s — fine for development, too slow for the 10s demo target. Lowering this is a Vigil-side concern, not part of this spec. |

## Testing

No unit tests for V1/V2 — the contracts exist to be deployed and upgraded, not to be correct. The "test" is the round-trip: `deploy-proxy` then `trigger-upgrade` against Base Sepolia, then confirming Vigil's watcher logged the upgrade.

The single manual verification:
1. `cd demo-target && npm install`
2. Populate `.env` with funded deployer key + RPC URL.
3. `npx hardhat run scripts/deploy-proxy.ts --network baseSepolia` → check Sourcify shows V1 verified.
4. In a separate terminal, `npm run dev` from repo root (Vigil agent).
5. `npx hardhat run scripts/trigger-upgrade.ts --network baseSepolia` → confirm Vigil logs `[UpgradeWatcher] Upgrade detected ...` within one poll interval.
6. Check Sourcify shows V2 verified.

Hardhat's local network is not used — there's no point testing the upgrade locally because Vigil's watcher is configured for Base Sepolia, and Sourcify only knows about deployed networks.

## Plan-doc reconciliation

After implementation lands, update [docs/development_plan.md](../../development_plan.md):
- Repo Layout section: replace `contracts/DemoProxy.sol` and `scripts/trigger-upgrade.ts` at repo root with the `demo-target/` sub-project tree.
- Day 1 J checklist: keep the bullet, point at `demo-target/scripts/trigger-upgrade.ts`.
- Open questions #4: mark as resolved (UUPS).

## Out of scope (deferred)

- Multiple `Vn` implementations to demonstrate severity gradients (could add `DemoTokenV3.sol` later if the differ needs more fixtures).
- Automated demo recovery (single command that resets proxy + watcher state).
- Mainnet deploy path.
- Replay-block helper script for Vigil's debug mode (Vigil's concern, not this sub-project's).
