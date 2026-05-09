# demo-cycle — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-command "pitch reset" for Vigil's revoke flow — bumps the V2 build stamp, deploys a fresh V2 impl, calls `upgradeToAndCall`, re-arms a `DEMO_WALLET → DEMO_SPENDER` approval, and (via a Claude skill) confirms a fresh alert lands so the `RevokeBanner` is armed.

**Architecture:** One Hardhat orchestration script (`demo-target/scripts/demo-cycle.ts`) runs the full sequence atomically; one Claude skill (`.claude/skills/demo-cycle/SKILL.md`) wraps it with alert-file polling + on-chain allowance verification. Same proxy reused across pitches; `previousUpgrades[]` array in `deployments/base-sepolia.json` accumulates history.

**Tech Stack:** Hardhat 2.x, ethers v6, `@openzeppelin/hardhat-upgrades` v3, TypeScript (CommonJS), Base Sepolia (chainId 84532). No new npm dependencies.

**Spec:** [docs/superpowers/specs/2026-05-09-demo-cycle-design.md](../specs/2026-05-09-demo-cycle-design.md).

---

## Plan-level notes (read once before starting)

- **Commit authorization:** This repo's global rule is *never commit without explicit user authorization*. Each task's final step proposes a commit message and pauses for the user to authorize (e.g. "do commit"). Don't batch.
- **TDD deviation:** This is operational tooling against a live testnet. There is no application logic with isolated unit-testable pure functions large enough to justify a test infra (the demo-target sub-project has no `test/` directory and no Mocha/Chai wired up). The "tests" are incremental script runs — after each task, a clearly-defined `npx ts-node` or `npm run` invocation produces output that proves the task's increment works. The full integration sweep is Task 6.
- **Sepolia gas budget:** Tasks 3, 4, and 6 each consume one upgrade tx + one approve tx (≈ 0.0005 ETH per cycle on Base Sepolia). Task 6 runs the cycle twice. Plan to have ≥ 0.005 ETH on the deployer wallet before Task 3.
- **Watcher dependency:** Task 6's alert verification requires the Vigil watcher to be running locally (`npm run watch` from repo root, or however the operator runs it). If the watcher is down, allowance verification still works, but the alert-file check will warn.
- **No new docs:** Do not create README/usage docs unless explicitly requested. The spec + this plan are the docs.

---

## File structure

```
Vigil/
├─ demo-target/
│  ├─ package.json                          # MODIFY: add "demo-cycle" npm script
│  ├─ scripts/
│  │  └─ demo-cycle.ts                      # NEW: orchestration script
│  └─ contracts/
│     └─ DemoTokenV2.sol                    # MUTATED at runtime (build-stamp bump)
├─ .claude/
│  └─ skills/
│     └─ demo-cycle/
│        └─ SKILL.md                        # NEW: Claude-invokable wrapper
└─ docs/
   └─ superpowers/
      └─ plans/
         └─ 2026-05-09-demo-cycle.md        # this file
```

---

## Task 1: Setup — npm script + skeleton + preflight

**Files:**
- Modify: `demo-target/package.json` (add `demo-cycle` script entry)
- Create: `demo-target/scripts/demo-cycle.ts` (skeleton)

This task makes `npm run demo-cycle` loadable and validates inputs without touching the chain.

- [ ] **Step 1: Add the npm script entry.**

Edit `demo-target/package.json`. Locate the `"scripts"` object (currently contains `compile`, `deploy`, `upgrade`, `seed-demo-wallet`, `reset`, `cycle`, `typecheck`). Add a new entry between `seed-demo-wallet` and `reset`:

```json
    "demo-cycle": "hardhat run scripts/demo-cycle.ts --network baseSepolia",
```

After edit, the `"scripts"` block reads:

```json
"scripts": {
  "compile": "hardhat compile",
  "deploy": "hardhat run scripts/deploy-proxy.ts --network baseSepolia",
  "upgrade": "hardhat run scripts/trigger-upgrade.ts --network baseSepolia",
  "seed-demo-wallet": "hardhat run scripts/seed-demo-wallet.ts --network baseSepolia",
  "demo-cycle": "hardhat run scripts/demo-cycle.ts --network baseSepolia",
  "reset": "ts-node scripts/reset.ts",
  "cycle": "npm run reset && npm run deploy && npm run upgrade",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 2: Create the script skeleton.**

Create `demo-target/scripts/demo-cycle.ts` with imports, constants, the `DeploymentRecord` type, the preflight body, and a stubbed `main` that exits after preflight:

```typescript
import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEMO_TARGET_ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(DEMO_TARGET_ROOT, "..");
const DEPLOYMENTS_PATH = path.join(DEMO_TARGET_ROOT, "deployments", "base-sepolia.json");
const V2_CONTRACT_PATH = path.join(DEMO_TARGET_ROOT, "contracts", "DemoTokenV2.sol");
const ALERTS_PATH = path.join(REPO_ROOT, "data", "alerts-base-sepolia.json");

const BUILD_STAMP_REGEX = /string public constant VIGIL_DEMO_BUILD = "[^"]*";/;
const TARGET_DEMO_BALANCE = ethers.parseEther("100");
const MIN_GAS_BALANCE = ethers.parseEther("0.005");

interface PreviousUpgrade {
  v2ImplAddress: string;
  upgradedAt: string;
  upgradeTxHash: string;
  upgradeBlockNumber: number | null;
  note: string;
}

interface DeploymentRecord {
  proxyAddress: string;
  v1ImplAddress: string;
  deployedAt: string;
  deployBlockNumber: number | null;
  deployTxHash?: string;
  v1ImplTxHash?: string;
  v2ImplAddress?: string;
  upgradedAt?: string;
  upgradeTxHash?: string;
  upgradeBlockNumber?: number | null;
  previousUpgrades?: PreviousUpgrade[];
}

async function main(): Promise<void> {
  console.log("[demo-cycle] starting…");

  if (!fs.existsSync(DEPLOYMENTS_PATH)) {
    throw new Error(`No deployment record at ${DEPLOYMENTS_PATH}. Run 'npm run deploy' first.`);
  }
  const record: DeploymentRecord = JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, "utf8"));
  if (!record.proxyAddress) throw new Error("No proxyAddress in deployments file.");

  const demoWalletKey = process.env.DEMO_WALLET_PRIVATE_KEY;
  const demoSpender = process.env.DEMO_SPENDER_ADDRESS;
  if (!demoWalletKey) throw new Error("Set DEMO_WALLET_PRIVATE_KEY in .env");
  if (!demoSpender) throw new Error("Set DEMO_SPENDER_ADDRESS in .env");
  if (!/^0x[a-fA-F0-9]{40}$/.test(demoSpender)) {
    throw new Error(`DEMO_SPENDER_ADDRESS is not a valid address: ${demoSpender}`);
  }

  const demoWallet = new ethers.Wallet(demoWalletKey, ethers.provider);
  const demoBalance = await ethers.provider.getBalance(demoWallet.address);
  if (demoBalance < MIN_GAS_BALANCE) {
    console.warn(
      `[demo-cycle] WARN: DEMO_WALLET ETH balance is ${ethers.formatEther(demoBalance)} (< 0.005); approve may run out of gas.`,
    );
  }

  if (!fs.existsSync(ALERTS_PATH)) {
    console.warn(`[demo-cycle] WARN: ${ALERTS_PATH} not found — is the watcher running?`);
  }

  console.log(`[demo-cycle] proxy:        ${record.proxyAddress}`);
  console.log(`[demo-cycle] DEMO_WALLET:  ${demoWallet.address}`);
  console.log(`[demo-cycle] DEMO_SPENDER: ${demoSpender}`);

  // TODO(task-2): build-stamp bump, compile, archive prior upgrade
  // TODO(task-3): prepareUpgrade + upgradeToAndCall + verify
  // TODO(task-4): approve from DEMO_WALLET with retry
  // TODO(task-5): summary

  console.log("[demo-cycle] preflight OK; remaining steps not yet implemented.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify it loads and runs preflight.**

Run from `demo-target/`:

```bash
npm run demo-cycle
```

Expected output (allowing for formatting variance):

```
[demo-cycle] starting…
[demo-cycle] proxy:        0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD
[demo-cycle] DEMO_WALLET:  0x6Dc4F249D5FEFDa93B434F97129eF15B87418BA5
[demo-cycle] DEMO_SPENDER: 0x21d5FF56C3aE684C1094B0c5Ff7F3E72DFf57203
[demo-cycle] preflight OK; remaining steps not yet implemented.
```

If you see "No deployment record" → the demo-target hasn't been deployed yet; run `npm run deploy` first and retry. If you see "Set DEMO_WALLET_PRIVATE_KEY" or similar → the `.env` file is missing those keys; cross-check against the existing `seed-demo-wallet.ts` env requirements.

- [ ] **Step 4: Type-check.**

Run from `demo-target/`:

```bash
npm run typecheck
```

Expected: no output, exit code 0.

- [ ] **Step 5: Pause for commit authorization.**

Propose to the user:

```
Task 1 done: npm script + script skeleton with preflight.
Suggested commit:
  feat(demo-target): scaffold demo-cycle script with preflight checks
Files: demo-target/package.json, demo-target/scripts/demo-cycle.ts
Authorize commit? (e.g. "do commit")
```

Do not run `git commit` until the user explicitly authorizes.

---

## Task 2: Pre-chain mutations — bump build stamp, compile, archive prior upgrade

**Files:**
- Modify: `demo-target/scripts/demo-cycle.ts`

These three steps all happen before any chain interaction. Done together so a single re-run can prove all three.

- [ ] **Step 1: Replace the `// TODO(task-2)` comment with the real body.**

Open `demo-target/scripts/demo-cycle.ts` and replace the line `// TODO(task-2): build-stamp bump, compile, archive prior upgrade` with the following block. The block goes after the preflight log lines and before `// TODO(task-3)`:

```typescript
  // ── Bump build stamp ─────────────────────────────────────────
  const v2Source = fs.readFileSync(V2_CONTRACT_PATH, "utf8");
  const matches = v2Source.match(new RegExp(BUILD_STAMP_REGEX, "g"));
  if (!matches || matches.length !== 1) {
    throw new Error(
      `Expected exactly one VIGIL_DEMO_BUILD constant in ${V2_CONTRACT_PATH}; found ${matches?.length ?? 0}`,
    );
  }
  const newStamp = new Date().toISOString();
  const v2Updated = v2Source.replace(
    BUILD_STAMP_REGEX,
    `string public constant VIGIL_DEMO_BUILD = "${newStamp}";`,
  );
  fs.writeFileSync(V2_CONTRACT_PATH, v2Updated);
  console.log(`[demo-cycle] bumped VIGIL_DEMO_BUILD → ${newStamp}`);

  // ── Compile (refresh artifacts so prepareUpgrade picks up new bytecode) ──
  console.log("[demo-cycle] compiling…");
  await hre.run("compile");

  // ── Archive prior upgrade ────────────────────────────────────
  if (record.v2ImplAddress) {
    if (!record.previousUpgrades) record.previousUpgrades = [];
    record.previousUpgrades.push({
      v2ImplAddress: record.v2ImplAddress,
      upgradedAt: record.upgradedAt!,
      upgradeTxHash: record.upgradeTxHash!,
      upgradeBlockNumber: record.upgradeBlockNumber ?? null,
      note: "demo-cycle replay",
    });
    delete record.v2ImplAddress;
    delete record.upgradedAt;
    delete record.upgradeTxHash;
    delete record.upgradeBlockNumber;
    fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(record, null, 2));
    console.log(
      `[demo-cycle] archived prior upgrade (now ${record.previousUpgrades.length} in history)`,
    );
  } else {
    console.log("[demo-cycle] no prior upgrade to archive");
  }
```

Note: the regex match uses a `new RegExp(BUILD_STAMP_REGEX, "g")` so `String.match` returns *all* hits (lets us assert exactly one). The replace below uses the original non-global regex (replaces only the first hit, which is the only one).

- [ ] **Step 2: Run and verify build-stamp bump + archival.**

Before running, snapshot current state:

```bash
grep VIGIL_DEMO_BUILD demo-target/contracts/DemoTokenV2.sol
cat demo-target/deployments/base-sepolia.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('top v2:', d.get('v2ImplAddress')); print('history:', len(d.get('previousUpgrades',[])))"
```

Run:

```bash
cd demo-target && npm run demo-cycle
```

Expected output includes:

```
[demo-cycle] bumped VIGIL_DEMO_BUILD → 2026-05-09T...
[demo-cycle] compiling…
... hardhat compile output ...
[demo-cycle] archived prior upgrade (now N in history)
[demo-cycle] preflight OK; remaining steps not yet implemented.
```

Verify post-state:

```bash
grep VIGIL_DEMO_BUILD demo-target/contracts/DemoTokenV2.sol
cat demo-target/deployments/base-sepolia.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('top v2:', d.get('v2ImplAddress')); print('history:', len(d.get('previousUpgrades',[])))"
```

Expected: timestamp updated, top-level `v2ImplAddress` is `None`/missing, `history` count incremented by 1. This confirms archival worked. Subsequent re-runs in this state will hit the `else` branch ("no prior upgrade to archive").

- [ ] **Step 3: Type-check.**

```bash
cd demo-target && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Pause for commit authorization.**

Propose:

```
Task 2 done: build-stamp bump, compile, archive prior upgrade.
Suggested commit:
  feat(demo-target): demo-cycle bumps build stamp and archives prior upgrade
Files: demo-target/scripts/demo-cycle.ts
NOTE: contracts/DemoTokenV2.sol and deployments/base-sepolia.json were also modified
at runtime by the verification step. Decide whether to include those in the commit
or revert them to the pre-task state for a cleaner diff.
Authorize commit? (e.g. "do commit")
```

---

## Task 3: Trigger upgrade — prepareUpgrade + upgradeToAndCall + Sourcify verify

**Files:**
- Modify: `demo-target/scripts/demo-cycle.ts`

First on-chain interactions. Costs ~0.0003 ETH on Base Sepolia.

- [ ] **Step 1: Replace `// TODO(task-3)` with the upgrade body.**

```typescript
  // ── Deploy fresh V2 impl + upgrade proxy ─────────────────────
  console.log("[demo-cycle] preparing fresh V2 impl…");
  const V2 = await ethers.getContractFactory("DemoTokenV2");
  const v2ImplAddress = (await upgrades.prepareUpgrade(record.proxyAddress, V2, {
    kind: "uups",
    unsafeSkipStorageCheck: true,
  })) as string;
  console.log(`[demo-cycle] new V2 impl: ${v2ImplAddress}`);

  console.log("[demo-cycle] calling upgradeToAndCall…");
  const proxy = await ethers.getContractAt("DemoTokenV2", record.proxyAddress);
  const upgradeTx = await proxy.upgradeToAndCall(v2ImplAddress, "0x");
  const receipt = await upgradeTx.wait();
  if (!receipt) throw new Error("upgradeToAndCall returned no receipt");

  record.v2ImplAddress = v2ImplAddress;
  record.upgradedAt = new Date().toISOString();
  record.upgradeTxHash = receipt.hash;
  record.upgradeBlockNumber = receipt.blockNumber;
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(record, null, 2));
  console.log(`[demo-cycle] upgrade tx: ${receipt.hash} (block ${receipt.blockNumber})`);

  // ── Sourcify verify (best-effort) ────────────────────────────
  console.log("[demo-cycle] verifying V2 impl on Sourcify…");
  try {
    await hre.run("verify:verify", { address: v2ImplAddress, constructorArguments: [] });
    console.log("[demo-cycle] V2 impl verified.");
  } catch (err) {
    console.warn("[demo-cycle] WARN: Sourcify verification failed:", err);
    console.warn(
      `[demo-cycle] Re-run manually: npx hardhat verify --network baseSepolia ${v2ImplAddress}`,
    );
  }
```

This uses the same OZ + verify pattern as `trigger-upgrade.ts`. The `unsafeSkipStorageCheck: true` is required because V2 deliberately collides with V1 storage.

- [ ] **Step 2: Run and verify a fresh upgrade tx.**

```bash
cd demo-target && npm run demo-cycle
```

Expected output includes (timestamps and addresses will differ):

```
[demo-cycle] preparing fresh V2 impl…
[demo-cycle] new V2 impl: 0x...
[demo-cycle] calling upgradeToAndCall…
[demo-cycle] upgrade tx: 0x... (block N)
[demo-cycle] verifying V2 impl on Sourcify…
[demo-cycle] V2 impl verified.
```

If verify fails with `Reason: Already verified` or transient Sourcify timeout — that's expected on retry; the warn log is fine.

Confirm on-chain:

```bash
cd demo-target && npx hardhat console --network baseSepolia <<'EOF'
const r = JSON.parse(require("fs").readFileSync("deployments/base-sepolia.json","utf8"));
console.log("v2ImplAddress:", r.v2ImplAddress);
const rcpt = await ethers.provider.getTransactionReceipt(r.upgradeTxHash);
console.log("status:", rcpt.status, "block:", rcpt.blockNumber);
EOF
```

Expected: `status: 1` and `v2ImplAddress` matches the new address.

- [ ] **Step 3: Type-check.**

```bash
cd demo-target && npm run typecheck
```

- [ ] **Step 4: Pause for commit authorization.**

```
Task 3 done: demo-cycle now triggers a fresh upgrade and verifies it.
Suggested commit:
  feat(demo-target): demo-cycle deploys fresh V2 impl + verifies on Sourcify
Files: demo-target/scripts/demo-cycle.ts
NOTE: contracts/DemoTokenV2.sol and deployments/base-sepolia.json were modified
at runtime; treat them the same as Task 2.
Authorize commit?
```

---

## Task 4: Approve from DEMO_WALLET with retry

**Files:**
- Modify: `demo-target/scripts/demo-cycle.ts`

Second on-chain interaction. Mirrors `seed-demo-wallet.ts` mint+approve, with the read-back retry loop added to dodge the stale-RPC zero we hit during spec validation.

- [ ] **Step 1: Replace `// TODO(task-4)` with the approve body.**

```typescript
  // ── Approve from DEMO_WALLET ─────────────────────────────────
  const [owner] = await ethers.getSigners();
  const token = await ethers.getContractAt("DemoTokenV1", record.proxyAddress, owner);

  const existingBalance: bigint = await token.balanceOf(demoWallet.address);
  if (existingBalance < TARGET_DEMO_BALANCE) {
    const need = TARGET_DEMO_BALANCE - existingBalance;
    console.log(`[demo-cycle] minting ${ethers.formatEther(need)} DEMO to demo wallet…`);
    const mintTx = await token.mint(demoWallet.address, need);
    await mintTx.wait();
  } else {
    console.log(
      `[demo-cycle] demo wallet holds ${ethers.formatEther(existingBalance)} DEMO — skipping mint`,
    );
  }

  const tokenAsDemo = token.connect(demoWallet) as typeof token;
  console.log("[demo-cycle] approving DEMO_SPENDER for MaxUint256 from DEMO_WALLET…");
  const approveTx = await tokenAsDemo.approve(demoSpender, ethers.MaxUint256);
  await approveTx.wait();

  let allowance: bigint = 0n;
  for (let attempt = 1; attempt <= 3; attempt++) {
    allowance = await token.allowance(demoWallet.address, demoSpender);
    if (allowance > 0n) break;
    console.log(`[demo-cycle] allowance read returned 0; retrying (${attempt}/3)…`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (allowance === 0n) {
    throw new Error("allowance is still 0 after 3 retries — approve may have failed");
  }
```

Note: `token` is bound to the deployer signer (for `mint`); `tokenAsDemo` rebinds to the DEMO_WALLET signer (for `approve`). Same pattern as `seed-demo-wallet.ts`.

- [ ] **Step 2: Run and verify the approve.**

```bash
cd demo-target && npm run demo-cycle
```

Expected output ends with:

```
[demo-cycle] demo wallet holds 100.0 DEMO — skipping mint   (or: minting X DEMO…)
[demo-cycle] approving DEMO_SPENDER for MaxUint256 from DEMO_WALLET…
```

(no allowance retry log if first read succeeds)

Confirm on-chain:

```bash
cd demo-target && npx hardhat console --network baseSepolia <<'EOF'
const r = JSON.parse(require("fs").readFileSync("deployments/base-sepolia.json","utf8"));
const t = await ethers.getContractAt("DemoTokenV1", r.proxyAddress);
const a = await t.allowance("0x6Dc4F249D5FEFDa93B434F97129eF15B87418BA5", process.env.DEMO_SPENDER_ADDRESS);
console.log("allowance =", a.toString());
EOF
```

Expected: `allowance = 115792089237316195423570985008687907853269984665640564039457584007913129639935` (MaxUint256).

- [ ] **Step 3: Type-check.**

```bash
cd demo-target && npm run typecheck
```

- [ ] **Step 4: Pause for commit authorization.**

```
Task 4 done: demo-cycle re-arms the DEMO_WALLET → DEMO_SPENDER approval.
Suggested commit:
  feat(demo-target): demo-cycle re-approves DEMO_SPENDER with retry
Files: demo-target/scripts/demo-cycle.ts
Authorize commit?
```

---

## Task 5: Summary output

**Files:**
- Modify: `demo-target/scripts/demo-cycle.ts`

Final operator-facing block. The skill (Task 7) parses this for the upgrade tx hash.

- [ ] **Step 1: Replace `// TODO(task-5)` with the summary.**

```typescript
  // ── Summary ──────────────────────────────────────────────────
  const allowanceLabel =
    allowance === ethers.MaxUint256 ? "MaxUint256" : allowance.toString();
  console.log("");
  console.log(`[demo-cycle] proxy:           ${record.proxyAddress}`);
  console.log(`[demo-cycle] new V2 impl:     ${v2ImplAddress}`);
  console.log(`[demo-cycle] upgrade tx:      ${receipt.hash}`);
  console.log(`[demo-cycle] upgrade block:   ${receipt.blockNumber}`);
  console.log(`[demo-cycle] DEMO_WALLET:     ${demoWallet.address}`);
  console.log(`[demo-cycle] allowance:       ${allowanceLabel}`);
  console.log(
    "[demo-cycle] modified files:  contracts/DemoTokenV2.sol, deployments/base-sepolia.json",
  );
  console.log(
    "[demo-cycle] next: open the UI on Base Sepolia, disconnect any wallet, click Revoke.",
  );
```

Also delete the now-stale "preflight OK; remaining steps not yet implemented." line at the end of `main`.

- [ ] **Step 2: Run and verify.**

```bash
cd demo-target && npm run demo-cycle
```

Expected: the summary block prints with all six fields filled in. The `upgrade tx:` line is the value the skill (Task 7) looks for — exact string `[demo-cycle] upgrade tx:` followed by `0x` + 64 hex chars.

- [ ] **Step 3: Type-check.**

```bash
cd demo-target && npm run typecheck
```

- [ ] **Step 4: Pause for commit authorization.**

```
Task 5 done: demo-cycle summary output.
Suggested commit:
  feat(demo-target): demo-cycle prints operator-facing summary
Files: demo-target/scripts/demo-cycle.ts
Authorize commit?
```

---

## Task 6: Integration verification — cold + hot

**Files:** none (verification only)

Two end-to-end runs, with explicit checks of the post-state.

- [ ] **Step 1: Cold run (post-revoke state).**

Precondition: ensure the current `DEMO_WALLET → DEMO_SPENDER` allowance is 0. If it isn't (e.g. previous task ran approve), revoke manually:

```bash
cd demo-target && npx hardhat console --network baseSepolia <<'EOF'
const r = JSON.parse(require("fs").readFileSync("deployments/base-sepolia.json","utf8"));
const t = await ethers.getContractAt("DemoTokenV1", r.proxyAddress);
const wallet = new ethers.Wallet(process.env.DEMO_WALLET_PRIVATE_KEY, ethers.provider);
const tx = await t.connect(wallet).approve(process.env.DEMO_SPENDER_ADDRESS, 0n);
await tx.wait();
console.log("revoked, allowance now 0");
EOF
```

Now run the cold cycle:

```bash
cd demo-target && npm run demo-cycle
```

Expected: full flow succeeds. Capture the upgrade tx hash from the summary.

- [ ] **Step 2: Verify the alert lands in the watcher's data file.**

If the watcher is running, wait ~10–30s, then:

```bash
cat data/alerts-base-sepolia.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
alerts = d if isinstance(d, list) else d.get('alerts', [])
target = '<paste upgrade tx hash from step 1>'
hits = [a for a in alerts if a.get('txHash') == target]
print('matching alerts:', len(hits))
"
```

Expected: `matching alerts: 1`. If 0 and the watcher is up, wait another 30s and re-check (poll interval). If 0 and the watcher isn't running, that's fine — note it and move on; the on-chain side is what matters for the cycle itself.

- [ ] **Step 3: Hot re-run (immediately, allowance still > 0).**

Capture the v2 impl address from the previous run:

```bash
cat demo-target/deployments/base-sepolia.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('current top v2:', d.get('v2ImplAddress'))
print('history count:', len(d.get('previousUpgrades', [])))
"
```

Then run again:

```bash
cd demo-target && npm run demo-cycle
```

Expected log includes: `[demo-cycle] archived prior upgrade (now N+1 in history)`. The "minting" line should say "skipping mint" because balance ≥ 100. Approve still re-runs (sets allowance to MaxUint256 again, which is a no-op effectively but a real tx).

Verify the previous v2 impl moved into history:

```bash
cat demo-target/deployments/base-sepolia.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
hist = d.get('previousUpgrades', [])
print('history count:', len(hist))
print('most recent archived:', hist[-1]['v2ImplAddress'] if hist else None)
print('current top v2:', d.get('v2ImplAddress'))
"
```

Expected: `history count` increased by 1 vs. step 3 precondition; the most-recently-archived entry matches the v2 impl address from step 1; current top v2 differs from both (because timestamp bump produced a new bytecode + new address).

- [ ] **Step 4: Pause for commit authorization.**

```
Task 6 done: cold + hot integration runs both pass; archival logic verified.
No code changes in this task — verification only.
Authorize moving to Task 7?
```

---

## Task 7: Create the Claude skill

**Files:**
- Create: `.claude/skills/demo-cycle/SKILL.md`

- [ ] **Step 1: Create the skill directory and file.**

Create `.claude/skills/demo-cycle/SKILL.md` with this exact content:

````markdown
---
name: demo-cycle
description: Run the demo cycle to re-arm Vigil's revoke banner before a pitch — bumps the V2 build stamp, redeploys + upgrades on Base Sepolia, re-approves DEMO_WALLET → DEMO_SPENDER, and verifies the alert lands and the banner is armed. Use when the operator says "demo cycle", "arm the demo", "prep the pitch", or before any live pitch run.
---

# demo-cycle skill

Re-arm the Vigil "your wallet is exposed" revoke banner so a fresh pitch run has a working revoke flow.

## When to use this skill

- Operator says "demo cycle", "arm the demo", "prep the pitch", "redo the demo", or anything that sounds like resetting the live-pitch state on Base Sepolia.
- Before a fresh pitch, after a previous run where the operator already clicked Revoke.

## Steps

Follow these steps exactly, in order. Track each as a TodoWrite item so the operator sees progress live.

### 1. Run the orchestration script

Run from the repo root:

```bash
cd demo-target && npm run demo-cycle 2>&1
```

Stream the output to the operator. Capture the upgrade tx hash by parsing the line matching exactly `[demo-cycle] upgrade tx: 0x<64 hex chars>` — that's the new alert tx hash.

If the script exits non-zero, stop. Surface the error to the operator and ask them to fix and re-run.

### 2. Verify the alert lands

The watcher writes alerts to `data/alerts-base-sepolia.json` (path relative to repo root). Poll for the captured tx hash:

- Read the file (it's JSON: either an array of alerts, or `{ alerts: [...] }`)
- Check for an entry where `chainId === 84532` and `txHash` matches the captured hash
- Interval: 5 s; Timeout: 60 s

If timeout: warn the operator that the watcher may not be running, but DO NOT FAIL — proceed to step 3. The on-chain state is what makes the banner show; the alert file is a UI-side concern.

### 3. Verify the on-chain allowance

Read `allowance(DEMO_WALLET, DEMO_SPENDER)` on the proxy. Use Hardhat console:

```bash
cd demo-target && npx hardhat console --network baseSepolia <<'EOF'
const r = JSON.parse(require("fs").readFileSync("deployments/base-sepolia.json","utf8"));
const t = await ethers.getContractAt("DemoTokenV1", r.proxyAddress);
const a = await t.allowance(process.env.DEMO_WALLET, process.env.DEMO_SPENDER_ADDRESS);
console.log("ALLOWANCE=" + a.toString());
EOF
```

Note: `process.env.DEMO_WALLET` is the address (set via `.env`). If it's not set, fall back to deriving the address from `DEMO_WALLET_PRIVATE_KEY` via `new ethers.Wallet(process.env.DEMO_WALLET_PRIVATE_KEY).address`.

Pass: parse the line `ALLOWANCE=<n>` and confirm `n > 0`. If 0 or parse fails: STOP and surface the failure.

### 4. Print the go message

If steps 1 and 3 both passed (step 2 may warn but not fail):

```
✅ Banner armed on alert tx 0x….
   Open the UI on Base Sepolia, disconnect any wallet, click Revoke.
```

If step 2 timed out but 1 + 3 passed, prepend a warning line:

```
⚠️ Alert not yet seen in data/alerts-base-sepolia.json after 60s — watcher may not be running.
✅ Banner armed on-chain (allowance > 0). Once the watcher catches up, the banner will appear in the UI.
   Open the UI on Base Sepolia, disconnect any wallet, click Revoke.
```

## What this skill never does

- Auto-commits modified files (operator commits when they choose).
- Drives the UI or opens a browser.
- Approves from any wallet other than `DEMO_WALLET`.
- Resets the proxy contract or touches ENS records.
- Skips step 1 to "save time" — even if the chain state already looks right, the operator wants a fresh alert per pitch.
````

- [ ] **Step 2: Confirm the file structure.**

```bash
ls -la .claude/skills/demo-cycle/
```

Expected:

```
SKILL.md
```

- [ ] **Step 3: Pause for commit authorization.**

```
Task 7 done: demo-cycle Claude skill created.
Suggested commit:
  feat(.claude): add demo-cycle skill for pitch reset
Files: .claude/skills/demo-cycle/SKILL.md
Authorize commit?
```

---

## Task 8: End-to-end skill verification

**Files:** none (verification only)

Confirm the skill works when invoked from a Claude Code session.

- [ ] **Step 1: Reset state to "post-revoke".**

```bash
cd demo-target && npx hardhat console --network baseSepolia <<'EOF'
const r = JSON.parse(require("fs").readFileSync("deployments/base-sepolia.json","utf8"));
const t = await ethers.getContractAt("DemoTokenV1", r.proxyAddress);
const wallet = new ethers.Wallet(process.env.DEMO_WALLET_PRIVATE_KEY, ethers.provider);
const tx = await t.connect(wallet).approve(process.env.DEMO_SPENDER_ADDRESS, 0n);
await tx.wait();
console.log("revoked, allowance now 0");
EOF
```

- [ ] **Step 2: Invoke the skill from a Claude Code session.**

In a Claude Code session in this repo, type a request that should match the skill's description, e.g.:

```
arm the demo for the next pitch
```

or:

```
do the demo cycle
```

Expected: Claude invokes the `demo-cycle` skill (per the using-superpowers guidance), runs the four checklist steps, and ends with one of the two go-message variants from step 4 of `SKILL.md`.

- [ ] **Step 3: Confirm UI behavior.**

Open the Vigil frontend on Base Sepolia (`http://localhost:3000` or wherever it's running). With **no wallet connected** (open in incognito if needed):

- The new alert from this run should be visible in the alert list (proxy `0x65953e…21AD`, fresh tx hash).
- The red "Your wallet is exposed" banner with the **Revoke approval** button should be visible on that alert card.
- Clicking **Revoke approval** should sign with the demo wallet, mine, and switch the banner to the green "Approval revoked" state.

- [ ] **Step 4: Pause for final commit / merge authorization.**

```
Task 8 done: skill verified end-to-end. The demo-cycle flow is ready for live pitching.
No code changes in this task.
Recommend any follow-up commits be batched as a single "demo-cycle: ready for pitch"
merge into the dev branch when authorized.
```

---

## Self-review checklist

Run this against the spec ([2026-05-09-demo-cycle-design.md](../specs/2026-05-09-demo-cycle-design.md)):

- **Goal coverage** — Tasks 1–5 build the script that does items 1, 2, 3 of the spec's Goal section; Task 6 verifies items 1+2; Task 7 + 8 cover item 3.
- **Non-goals respected** — No proxy reset, no ENS touch, no auto-commit, no UI driving, no Base mainnet, no non-DEMO_WALLET approve. Confirmed in the script body and SKILL.md "what this skill never does".
- **Decisions table** — Cycle depth (light replay) implemented in Tasks 2-3; build-stamp bump in Task 2; DEMO_WALLET as approver in Task 4; MaxUint256 in Task 4; single Hardhat run (Tasks 1-5 all in `main`); both `npm run demo-cycle` and skill in Tasks 1+7; Sourcify best-effort in Task 3; existing scripts untouched (only new file + package.json edit); no auto-commit (every task pauses).
- **Architecture file table** — Every file in the spec's "Touched files" table appears in this plan's File structure section. `demo-target/.openzeppelin/base-sepolia.json` is mutated by `prepareUpgrade` in Task 3 (no explicit step needed; it's an OZ-plugin side effect).
- **Failure recovery section** — Spec says script killed mid-run is self-healing. The script body in Tasks 2–3 implements this: archival happens before chain calls; if killed between archive and upgrade, the next run hits the `else` branch and proceeds. Confirmed in Task 6's hot re-run.
- **Testing section** — Spec lists 5 verification scenarios. Tasks 6 + 8 cover them: cold (6.1), hot (6.3), skill path (8.2), failure path (skill step 2 timeout handling, Task 7 SKILL.md), UI smoke (8.3).
- **Open questions** — Spec's two assumptions (watcher running locally; Base Sepolia only) are explicit in plan-level notes.
- **Type consistency** — `DeploymentRecord` interface in Task 1 used in Tasks 2, 3; `PreviousUpgrade` interface in Task 1 used in Task 2's archive block; `BUILD_STAMP_REGEX`, `TARGET_DEMO_BALANCE`, `MIN_GAS_BALANCE` constants defined in Task 1 used later. All field names (`v2ImplAddress`, `upgradedAt`, `upgradeTxHash`, `upgradeBlockNumber`) match the existing `deployments/base-sepolia.json` schema.
- **Placeholders** — None. Every step has either exact code, exact commands, or exact expected output.
