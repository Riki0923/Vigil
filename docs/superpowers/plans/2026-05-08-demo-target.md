# Demo target — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Hardhat sub-project at `demo-target/` that deploys a UUPS-upgradeable ERC20 to Base Sepolia and triggers an intentionally-vulnerable upgrade, so Vigil's watcher has a controllable upgrade event for testing and demos.

**Architecture:** Sub-project with its own `package.json` and `node_modules`, isolated from the agent runtime. Two Solidity contracts (V1 = clean, V2 = three deliberate vulnerabilities: storage collision, public-mint access loss, drain backdoor). Two TypeScript scripts (`deploy-proxy`, `trigger-upgrade`) using `@openzeppelin/hardhat-upgrades` for proxy mechanics and `hardhat-verify` for Sourcify verification. Deployment state persisted in `deployments/base-sepolia.json` for idempotent re-runs.

**Tech Stack:** Hardhat 2.x, Solidity 0.8.24, `@openzeppelin/contracts-upgradeable` v5, `@openzeppelin/hardhat-upgrades` v3, `@nomicfoundation/hardhat-toolbox` v5, TypeScript (CommonJS — Hardhat 2.x has friction with ESM), Base Sepolia (chainId 84532).

**Spec:** [docs/superpowers/specs/2026-05-08-demo-target-design.md](../specs/2026-05-08-demo-target-design.md).

---

## Plan-level notes (read once before starting)

- **Commit authorization:** This repo's global rule is *never commit without explicit user authorization*. Each task ends with a "Commit" step — surface the proposed commit message and wait for explicit user authorization (e.g. "do commit") before running `git commit`. Don't batch.
- **TDD deviation:** Tasks 1–6 are deploy infrastructure with no behavioral logic to unit-test. The "tests" for those tasks are compilation checks (`hardhat compile`) and type checks (`tsc --noEmit`). The real integration test is the manual Base Sepolia round-trip in Tasks 7–8. The spec calls this out explicitly.
- **Working directory:** Tasks 1–6 and 9 work from the repo root or `demo-target/`. Tasks 7–8 require a funded Base Sepolia wallet — surface this prereq to the user before starting Task 7.
- **No new docs:** Per global rule, do not create `README.md` or other documentation files unless the user explicitly requests them. The spec is the docs.

---

## File structure

```
Vigil/
├─ .gitignore                              # MODIFY: add demo-target/deployments pattern
├─ docs/
│  └─ development_plan.md                  # MODIFY: reflect demo-target/ layout (Task 9)
└─ demo-target/                            # NEW
   ├─ .env.example                         # NEW
   ├─ .gitignore                           # NEW (subfolder gitignore)
   ├─ package.json                         # NEW
   ├─ tsconfig.json                        # NEW
   ├─ hardhat.config.ts                    # NEW
   ├─ contracts/
   │  ├─ DemoTokenV1.sol                   # NEW
   │  └─ DemoTokenV2.sol                   # NEW
   └─ scripts/
      ├─ deploy-proxy.ts                   # NEW
      └─ trigger-upgrade.ts                # NEW
```

Files generated at runtime (not committed):
- `demo-target/node_modules/`
- `demo-target/cache/`, `demo-target/artifacts/` (Hardhat build output)
- `demo-target/deployments/base-sepolia.json` (deploy script output)

---

## Task 1: Bootstrap the sub-project

**Files:**
- Create: `demo-target/package.json`
- Create: `demo-target/tsconfig.json`
- Create: `demo-target/.env.example`
- Create: `demo-target/.gitignore`
- Modify: `.gitignore` (root)

- [ ] **Step 1: Create the demo-target folder**

```bash
mkdir -p demo-target/contracts demo-target/scripts
```

- [ ] **Step 2: Create `demo-target/package.json`**

```json
{
  "name": "vigil-demo-target",
  "version": "1.0.0",
  "private": true,
  "description": "Upgradeable proxy demo target for Vigil — Base Sepolia",
  "scripts": {
    "compile": "hardhat compile",
    "deploy": "hardhat run scripts/deploy-proxy.ts --network baseSepolia",
    "upgrade": "hardhat run scripts/trigger-upgrade.ts --network baseSepolia",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "@openzeppelin/hardhat-upgrades": "^3.5.0",
    "@types/node": "^20.0.0",
    "hardhat": "^2.22.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.4.0"
  },
  "dependencies": {
    "@openzeppelin/contracts-upgradeable": "^5.0.0",
    "dotenv": "^16.4.0"
  }
}
```

Note: no `"type": "module"` — Hardhat 2.x runs cleanly on CommonJS. The agent's `package.json` is `type: module`; this sub-project is intentionally CommonJS.

- [ ] **Step 3: Create `demo-target/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist"
  },
  "include": ["./scripts", "./hardhat.config.ts"]
}
```

- [ ] **Step 4: Create `demo-target/.env.example`**

```
# Base Sepolia RPC — must match Vigil agent's RPC_URL for the watcher to see deploys
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Deployer wallet private key — must hold Base Sepolia ETH (faucet: https://www.alchemy.com/faucets/base-sepolia)
DEPLOYER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000
```

- [ ] **Step 5: Create `demo-target/.gitignore`**

```
node_modules/
cache/
artifacts/
dist/
.env
deployments/
```

- [ ] **Step 6: Update root `.gitignore`**

The root `.gitignore` currently contains:
```
node_modules
.env
docs/
```

Append `demo-target/deployments/` for safety belt-and-braces (the sub-folder `.gitignore` already covers it, but git's tree-walking benefits from the explicit root entry):

```bash
printf '\ndemo-target/deployments/\n' >> .gitignore
```

- [ ] **Step 7: Install dependencies**

Run from `demo-target/`:

```bash
cd demo-target && npm install
```

Expected: completes without errors, populates `demo-target/node_modules/` and creates `demo-target/package-lock.json`.

- [ ] **Step 8: Verify the toolchain**

```bash
cd demo-target && npx hardhat --version
```

Expected: prints a 2.x version (e.g. `2.22.x`).

- [ ] **Step 9: Commit (requires user authorization)**

Files to stage: `demo-target/package.json`, `demo-target/package-lock.json`, `demo-target/tsconfig.json`, `demo-target/.env.example`, `demo-target/.gitignore`, root `.gitignore`.

Proposed message: `chore(demo-target): bootstrap hardhat sub-project`

```bash
git add demo-target/package.json demo-target/package-lock.json demo-target/tsconfig.json demo-target/.env.example demo-target/.gitignore .gitignore
git commit -m "chore(demo-target): bootstrap hardhat sub-project"
```

Do NOT run the commit until the user authorizes ("do commit", "commit that", etc.).

---

## Task 2: Hardhat config

**Files:**
- Create: `demo-target/hardhat.config.ts`

- [ ] **Step 1: Write `demo-target/hardhat.config.ts`**

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.RPC_URL ?? "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    baseSepolia: {
      url: RPC_URL,
      chainId: 84532,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  sourcify: {
    enabled: true,
  },
  // etherscan intentionally unset — verifying via Sourcify only.
};

export default config;
```

- [ ] **Step 2: Verify the config loads**

Run from `demo-target/`:

```bash
cd demo-target && npx hardhat compile
```

Expected: completes successfully. Output will say "Nothing to compile" (no `.sol` files yet) — that's the success signal. If the config has an error, this command will fail with a parse/import error.

- [ ] **Step 3: Commit (requires user authorization)**

Proposed message: `feat(demo-target): hardhat config for base sepolia + sourcify`

```bash
git add demo-target/hardhat.config.ts
git commit -m "feat(demo-target): hardhat config for base sepolia + sourcify"
```

Wait for user authorization before running.

---

## Task 3: V1 contract (clean baseline)

**Files:**
- Create: `demo-target/contracts/DemoTokenV1.sol`

- [ ] **Step 1: Write `demo-target/contracts/DemoTokenV1.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract DemoTokenV1 is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    bool public paused;
    uint256 public mintCap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 initialSupply,
        uint256 mintCap_
    ) external initializer {
        __ERC20_init("DemoToken", "DEMO");
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        mintCap = mintCap_;
        _mint(owner_, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(!paused, "paused");
        require(totalSupply() + amount <= mintCap, "cap");
        _mint(to, amount);
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

- [ ] **Step 2: Compile**

```bash
cd demo-target && npx hardhat compile
```

Expected: `Compiled N Solidity files successfully` (N includes V1 and OpenZeppelin transitives). No errors, no warnings except possibly the OZ "unused parameter" warning on `_authorizeUpgrade` — that is expected and intentional.

- [ ] **Step 3: Verify the artifact exists**

```bash
ls demo-target/artifacts/contracts/DemoTokenV1.sol/DemoTokenV1.json
```

Expected: file exists.

- [ ] **Step 4: Commit (requires user authorization)**

Proposed message: `feat(demo-target): add DemoTokenV1 uups contract`

```bash
git add demo-target/contracts/DemoTokenV1.sol
git commit -m "feat(demo-target): add DemoTokenV1 uups contract"
```

Wait for user authorization.

---

## Task 4: V2 contract (vulnerable upgrade)

**Files:**
- Create: `demo-target/contracts/DemoTokenV2.sol`

- [ ] **Step 1: Write `demo-target/contracts/DemoTokenV2.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// VULNERABLE — for Vigil testing only. Do not use in production.
//
// Three deliberate sins relative to V1:
//   1. emergencyAdmin inserted as the first state var → shifts paused/mintCap by one slot (storage collision).
//   2. mint() loses its onlyOwner modifier → anyone can mint.
//   3. drain() has no access modifier → anyone can transfer any balance to themselves.
contract DemoTokenV2 is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    address public emergencyAdmin;
    bool public paused;
    uint256 public mintCap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        uint256 initialSupply,
        uint256 mintCap_
    ) external initializer {
        __ERC20_init("DemoToken", "DEMO");
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        mintCap = mintCap_;
        _mint(owner_, initialSupply);
    }

    function mint(address to, uint256 amount) external {
        require(!paused, "paused");
        require(totalSupply() + amount <= mintCap, "cap");
        _mint(to, amount);
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function drain(address victim, uint256 amount) external {
        _burn(victim, amount);
        _mint(msg.sender, amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

- [ ] **Step 2: Compile**

```bash
cd demo-target && npx hardhat compile
```

Expected: `Compiled N Solidity files successfully` (now includes V2). No errors.

- [ ] **Step 3: Verify both artifacts exist**

```bash
ls demo-target/artifacts/contracts/DemoTokenV1.sol/DemoTokenV1.json demo-target/artifacts/contracts/DemoTokenV2.sol/DemoTokenV2.json
```

Expected: both files exist.

- [ ] **Step 4: Commit (requires user authorization)**

Proposed message: `feat(demo-target): add DemoTokenV2 with deliberate vulns`

```bash
git add demo-target/contracts/DemoTokenV2.sol
git commit -m "feat(demo-target): add DemoTokenV2 with deliberate vulns"
```

Wait for user authorization.

---

## Task 5: Deploy script

**Files:**
- Create: `demo-target/scripts/deploy-proxy.ts`

- [ ] **Step 1: Write `demo-target/scripts/deploy-proxy.ts`**

```typescript
import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");
const DEPLOYMENTS_PATH = path.join(DEPLOYMENTS_DIR, "base-sepolia.json");

interface DeploymentRecord {
  proxyAddress: string;
  v1ImplAddress: string;
  deployedAt: string;
  deployBlockNumber: number | null;
  v2ImplAddress?: string;
  upgradedAt?: string;
  upgradeTxHash?: string;
  upgradeBlockNumber?: number | null;
}

async function main(): Promise<void> {
  if (fs.existsSync(DEPLOYMENTS_PATH)) {
    const existing: DeploymentRecord = JSON.parse(
      fs.readFileSync(DEPLOYMENTS_PATH, "utf8"),
    );
    console.log("[deploy-proxy] Existing deployment found:");
    console.log(JSON.stringify(existing, null, 2));
    console.log(
      "[deploy-proxy] Skipping deploy. Delete deployments/base-sepolia.json to redeploy.",
    );
    return;
  }

  const [deployer] = await ethers.getSigners();
  console.log(`[deploy-proxy] Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy-proxy] Balance:  ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has 0 ETH on Base Sepolia. Fund the wallet from a faucet first.",
    );
  }

  const initialSupply = ethers.parseEther("1000");
  const mintCap = ethers.parseEther("1000000");

  console.log("[deploy-proxy] Deploying V1 + UUPS proxy...");
  const V1 = await ethers.getContractFactory("DemoTokenV1");
  const proxy = await upgrades.deployProxy(
    V1,
    [deployer.address, initialSupply, mintCap],
    { kind: "uups" },
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const v1ImplAddress =
    await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const deployTx = proxy.deploymentTransaction();
  const deployReceipt = deployTx ? await deployTx.wait() : null;

  const record: DeploymentRecord = {
    proxyAddress,
    v1ImplAddress,
    deployedAt: new Date().toISOString(),
    deployBlockNumber: deployReceipt?.blockNumber ?? null,
  };

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(record, null, 2));

  console.log(`[deploy-proxy] Proxy:    ${proxyAddress}`);
  console.log(`[deploy-proxy] V1 impl:  ${v1ImplAddress}`);
  console.log(`[deploy-proxy] Block:    ${record.deployBlockNumber}`);

  console.log("[deploy-proxy] Verifying V1 impl on Sourcify...");
  try {
    await hre.run("verify:verify", {
      address: v1ImplAddress,
      constructorArguments: [],
    });
    console.log("[deploy-proxy] V1 impl verified.");
  } catch (err) {
    console.warn("[deploy-proxy] Sourcify verification failed:", err);
    console.warn(
      `[deploy-proxy] Re-run manually: npx hardhat verify --network baseSepolia ${v1ImplAddress}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check the script**

```bash
cd demo-target && npx tsc --noEmit
```

Expected: completes with no errors. If it fails, fix the type error before proceeding (do not silence with `any`).

- [ ] **Step 3: Commit (requires user authorization)**

Proposed message: `feat(demo-target): add deploy-proxy script`

```bash
git add demo-target/scripts/deploy-proxy.ts
git commit -m "feat(demo-target): add deploy-proxy script"
```

Wait for user authorization.

---

## Task 6: Trigger-upgrade script

**Files:**
- Create: `demo-target/scripts/trigger-upgrade.ts`

- [ ] **Step 1: Write `demo-target/scripts/trigger-upgrade.ts`**

```typescript
import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_PATH = path.join(
  __dirname,
  "..",
  "deployments",
  "base-sepolia.json",
);

interface DeploymentRecord {
  proxyAddress: string;
  v1ImplAddress: string;
  deployedAt: string;
  deployBlockNumber: number | null;
  v2ImplAddress?: string;
  upgradedAt?: string;
  upgradeTxHash?: string;
  upgradeBlockNumber?: number | null;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DEPLOYMENTS_PATH)) {
    console.error(`[trigger-upgrade] No deployments file at ${DEPLOYMENTS_PATH}`);
    console.error("[trigger-upgrade] Run scripts/deploy-proxy.ts first.");
    process.exit(1);
  }

  const record: DeploymentRecord = JSON.parse(
    fs.readFileSync(DEPLOYMENTS_PATH, "utf8"),
  );

  if (record.v2ImplAddress) {
    console.log("[trigger-upgrade] Proxy already upgraded to V2:");
    console.log(JSON.stringify(record, null, 2));
    console.log(
      "[trigger-upgrade] Delete deployments/base-sepolia.json and re-deploy to start over.",
    );
    return;
  }

  const [signer] = await ethers.getSigners();
  console.log(`[trigger-upgrade] Signer: ${signer.address}`);
  console.log(`[trigger-upgrade] Proxy:  ${record.proxyAddress}`);

  console.log("[trigger-upgrade] Deploying V2 impl (storage check skipped)...");
  const V2 = await ethers.getContractFactory("DemoTokenV2");
  const v2ImplAddress = (await upgrades.prepareUpgrade(
    record.proxyAddress,
    V2,
    { kind: "uups", unsafeSkipStorageCheck: true },
  )) as string;
  console.log(`[trigger-upgrade] V2 impl: ${v2ImplAddress}`);

  console.log("[trigger-upgrade] Calling upgradeToAndCall on the proxy...");
  const proxy = await ethers.getContractAt("DemoTokenV2", record.proxyAddress);
  const upgradeTx = await proxy.upgradeToAndCall(v2ImplAddress, "0x");
  const receipt = await upgradeTx.wait();
  if (!receipt) {
    throw new Error("upgradeToAndCall returned no receipt");
  }

  record.v2ImplAddress = v2ImplAddress;
  record.upgradedAt = new Date().toISOString();
  record.upgradeTxHash = receipt.hash;
  record.upgradeBlockNumber = receipt.blockNumber;

  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(record, null, 2));

  console.log(`[trigger-upgrade] Tx:     ${record.upgradeTxHash}`);
  console.log(`[trigger-upgrade] Block:  ${record.upgradeBlockNumber}`);

  console.log("[trigger-upgrade] Verifying V2 impl on Sourcify...");
  try {
    await hre.run("verify:verify", {
      address: v2ImplAddress,
      constructorArguments: [],
    });
    console.log("[trigger-upgrade] V2 impl verified.");
  } catch (err) {
    console.warn("[trigger-upgrade] Sourcify verification failed:", err);
    console.warn(
      `[trigger-upgrade] Re-run manually: npx hardhat verify --network baseSepolia ${v2ImplAddress}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check the script**

```bash
cd demo-target && npx tsc --noEmit
```

Expected: completes with no errors.

- [ ] **Step 3: Commit (requires user authorization)**

Proposed message: `feat(demo-target): add trigger-upgrade script`

```bash
git add demo-target/scripts/trigger-upgrade.ts
git commit -m "feat(demo-target): add trigger-upgrade script"
```

Wait for user authorization.

---

## Task 7: Manual integration — deploy V1 to Base Sepolia

**This task requires a funded Base Sepolia wallet. Surface this prereq to the user before starting.**

**Files:**
- Create (by running script): `demo-target/.env`, `demo-target/deployments/base-sepolia.json`

- [ ] **Step 1: Confirm prereq with user**

Ask the user:
> "Task 7 deploys V1 to Base Sepolia. I need:
> 1. A Base Sepolia RPC URL (you can reuse `RPC_URL` from the agent's `.env`).
> 2. A funded deployer wallet's private key on Base Sepolia (faucet: https://www.alchemy.com/faucets/base-sepolia).
> Do you have both ready?"

Wait for confirmation. Do not proceed until the user confirms the wallet is funded.

- [ ] **Step 2: Populate `demo-target/.env`**

Have the user paste their values into `demo-target/.env`. The file should look like:

```
RPC_URL=https://base-sepolia.g.alchemy.com/v2/REAL_KEY
DEPLOYER_PRIVATE_KEY=0xREAL_KEY
```

Confirm the file exists and has both values populated (not the example placeholders).

- [ ] **Step 3: Run the deploy**

```bash
cd demo-target && npm run deploy
```

Expected output structure (addresses will vary):

```
[deploy-proxy] Deployer: 0x...
[deploy-proxy] Balance:  X.XX ETH
[deploy-proxy] Deploying V1 + UUPS proxy...
[deploy-proxy] Proxy:    0x...
[deploy-proxy] V1 impl:  0x...
[deploy-proxy] Block:    NNNNNN
[deploy-proxy] Verifying V1 impl on Sourcify...
[deploy-proxy] V1 impl verified.
```

If Sourcify verification fails (network blip or rate limit), the deploy still succeeds — it just prints a warning with the manual re-run command. That's recoverable.

- [ ] **Step 4: Verify deployments file**

```bash
cat demo-target/deployments/base-sepolia.json
```

Expected: JSON with `proxyAddress`, `v1ImplAddress`, `deployedAt`, `deployBlockNumber`. No `v2ImplAddress` yet.

- [ ] **Step 5: Verify Sourcify entry**

In a browser, open:

```
https://repo.sourcify.dev/contracts/full_match/84532/<v1ImplAddress>/
```

Expected: page exists and shows `DemoTokenV1.sol`. If it 404s, run `npx hardhat verify --network baseSepolia <v1ImplAddress>` from `demo-target/` and re-check.

- [ ] **Step 6: Commit deployments file (requires user authorization)**

Wait — `demo-target/deployments/` is gitignored on purpose (the spec says so; the addresses are environment-specific testing artifacts). **Skip this commit.** Surface to the user that the deployments file is intentionally untracked, so they don't worry about uncommitted changes.

---

## Task 8: Manual integration — trigger upgrade and watch Vigil pick it up

**Files:**
- Modify (by running script): `demo-target/deployments/base-sepolia.json`

- [ ] **Step 1: Verify Vigil agent's RPC matches**

```bash
grep RPC_URL .env
```

Expected: shows the same Base Sepolia RPC URL (or an equivalent one pointing at chainId 84532) that `demo-target/.env` uses. If the agent's `.env` is missing or pointed elsewhere, surface this to the user — the watcher can't see upgrades on a different network.

- [ ] **Step 2: Start the Vigil agent**

In **terminal A** (repo root):

```bash
npm run dev
```

Expected output:

```
[Vigil] Connected to network: ... (chainId: 84532)
[Vigil] Current block: NNNNNN
[UpgradeWatcher] Listening for EIP-1967 Upgraded events...
```

Leave this terminal running.

- [ ] **Step 3: Trigger the upgrade**

In **terminal B** (`demo-target/`):

```bash
cd demo-target && npm run upgrade
```

Expected output structure:

```
[trigger-upgrade] Signer: 0x...
[trigger-upgrade] Proxy:  0x...
[trigger-upgrade] Deploying V2 impl (storage check skipped)...
[trigger-upgrade] V2 impl: 0x...
[trigger-upgrade] Calling upgradeToAndCall on the proxy...
[trigger-upgrade] Tx:     0x...
[trigger-upgrade] Block:  NNNNNN
[trigger-upgrade] Verifying V2 impl on Sourcify...
[trigger-upgrade] V2 impl verified.
```

- [ ] **Step 4: Verify Vigil saw the upgrade**

Switch to **terminal A** within `POLL_INTERVAL_MS` (currently 30s). Expected new lines:

```
[UpgradeWatcher] Upgrade detected at block NNNNNN
  Proxy:          0x... (matches deployments/base-sepolia.json proxyAddress)
  Implementation: 0x... (matches the V2 impl from terminal B)
  Tx:             0x... (matches upgradeTxHash)
[Vigil] Processing upgrade
  ...
```

If Vigil's terminal stays silent for >60s, the watcher missed the event. Diagnose:
1. Confirm `RPC_URL` matches between the two `.env` files.
2. Confirm `chainId: 84532` is what both connected to.
3. Try the spec's documented replay: temporarily change `upgradeWatcher.ts` to use `fromBlock: <upgradeBlockNumber>, toBlock: <upgradeBlockNumber>` and restart.

- [ ] **Step 5: Verify deployments file updated**

```bash
cat demo-target/deployments/base-sepolia.json
```

Expected: now includes `v2ImplAddress`, `upgradedAt`, `upgradeTxHash`, `upgradeBlockNumber`.

- [ ] **Step 6: Verify V2 on Sourcify**

```
https://repo.sourcify.dev/contracts/full_match/84532/<v2ImplAddress>/
```

Expected: page shows `DemoTokenV2.sol`. This is the Day 2 dependency — Vigil's `src/sourcify/` consumer will fetch source from here.

- [ ] **Step 7: Stop the agent**

In terminal A: `Ctrl+C`. Surface the upgrade tx hash and the proxy address to the user — these are the values they'll cite during the demo.

---

## Task 9: Reconcile the development plan

**Files:**
- Modify: `docs/development_plan.md`

The development plan currently lists `contracts/DemoProxy.sol` and `scripts/trigger-upgrade.ts` at the repo root, and flags proxy pattern as Kristian-question #4. Both need updating.

- [ ] **Step 1: Read the current state**

Read `docs/development_plan.md` and locate:
1. The Repo Layout section — the block under "J adds (not yet created — wait for K's surface to stabilize):" ending with `└─ trigger-upgrade.ts`.
2. The Day 1 J checklist — the bullet "Deploy `DemoProxy.sol` to Base Sepolia. Trigger script in `scripts/trigger-upgrade.ts`."
3. Open question #4 — "Demo proxy on Base Sepolia — any preferences for the proxy pattern (transparent / UUPS), or J picks?"

- [ ] **Step 2: Update Repo Layout**

In `docs/development_plan.md`, replace this block:

```
contracts/                      # demo proxy + trigger
└─ DemoProxy.sol
scripts/
└─ trigger-upgrade.ts
```

With:

```
demo-target/                    # standalone hardhat sub-project — vigil's testing target
├─ contracts/
│  ├─ DemoTokenV1.sol
│  └─ DemoTokenV2.sol           # vulnerable upgrade: storage collision + public mint + drain backdoor
├─ scripts/
│  ├─ deploy-proxy.ts
│  └─ trigger-upgrade.ts
├─ deployments/                 # gitignored — proxy + impl addresses (per-network)
└─ hardhat.config.ts            # base sepolia + sourcify
```

- [ ] **Step 3: Update Day 1 J checklist**

Replace this bullet:

```
- [ ] Deploy `DemoProxy.sol` to Base Sepolia. Trigger script in `scripts/trigger-upgrade.ts`.
```

With:

```
- [ ] Deploy `demo-target/` proxy to Base Sepolia. Trigger script in `demo-target/scripts/trigger-upgrade.ts`. UUPS pattern, intentionally-vulnerable V2 (collision + access loss + backdoor) for differ + assessor calibration.
```

- [ ] **Step 4: Update Open question #4**

Replace this bullet:

```
4. **Demo proxy on Base Sepolia** — any preferences for the proxy pattern (transparent / UUPS), or J picks?
```

With:

```
4. ~~**Demo proxy on Base Sepolia** — any preferences for the proxy pattern (transparent / UUPS), or J picks?~~ **Resolved: UUPS.** See [demo-target/](../demo-target/) and [docs/superpowers/specs/2026-05-08-demo-target-design.md](superpowers/specs/2026-05-08-demo-target-design.md).
```

- [ ] **Step 5: Commit (requires user authorization)**

Note: `docs/` is gitignored at the repo root. The development plan is a working doc, not a tracked artifact. **Skip this commit** — modifying a gitignored file leaves the working tree clean. Surface to the user: "Updated `docs/development_plan.md`; it's gitignored so no commit needed."

---

## Self-review checklist

Before handing off to execution, verify:

**Spec coverage:**
- [x] V1 contract → Task 3
- [x] V2 contract with three vulns → Task 4
- [x] `deploy-proxy.ts` → Task 5 + Task 7
- [x] `trigger-upgrade.ts` → Task 6 + Task 8
- [x] `hardhat.config.ts` → Task 2
- [x] `package.json`, `tsconfig.json`, `.env.example` → Task 1
- [x] `deployments/base-sepolia.json` gitignored → Task 1 (sub-folder gitignore + root entry)
- [x] Sourcify verification of V1 + V2 → Tasks 5/6 (in scripts) + Tasks 7/8 (manual confirm)
- [x] Plan-doc reconciliation → Task 9

**Type consistency:**
- `DeploymentRecord` interface defined identically in `deploy-proxy.ts` (Task 5) and `trigger-upgrade.ts` (Task 6).
- Contract names `DemoTokenV1` / `DemoTokenV2` consistent across `.sol` files, factory calls, and `getContractAt` calls.
- `RPC_URL` and `DEPLOYER_PRIVATE_KEY` env var names consistent across `.env.example`, `hardhat.config.ts`, and the user-facing prereq prompt in Task 7.

**No placeholders:** every code step shows the full file content; every command step shows the exact command and expected output.
