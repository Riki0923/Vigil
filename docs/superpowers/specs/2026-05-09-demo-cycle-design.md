# Demo-cycle — repeatable pitch reset for the revoke flow

**Date:** 2026-05-09
**Owner:** J (0xj4an)
**Status:** Spec, awaiting review
**Related:** [demo-target/scripts/trigger-upgrade.ts](../../../demo-target/scripts/trigger-upgrade.ts), [demo-target/scripts/seed-demo-wallet.ts](../../../demo-target/scripts/seed-demo-wallet.ts), [frontend/app/components/RevokeBanner.tsx](../../../frontend/app/components/RevokeBanner.tsx)

## Goal

Give the operator a one-command reset between consecutive pitches that:

1. Fires a **fresh** Vigil upgrade alert on the existing demo proxy (new tx hash, new V2 impl address, new alert card in the UI).
2. Re-arms an **active ERC20 approval** from `DEMO_WALLET` to `DEMO_SPENDER` on the proxy, so the `RevokeBanner` shows on the new alert card.
3. Exits with a clear summary the operator can read mid-pitch ("banner ready on tx 0x…; disconnect any wallet").

After running, the pitch demonstrator can click **Revoke approval** in the UI; the next pitch run repeats the cycle.

## Non-goals

- Resetting the proxy contract itself. Same proxy address is reused across pitches (cycle option **A**, picked over full `reset && deploy && upgrade`).
- Touching ENS records. `<protocol>.vigil.eth` records still point at the same proxy; nothing to repoint.
- Auto-committing modified files. Per repo git rules, the operator commits when they want.
- Driving the UI. The skill verifies on-chain + alerts-file state; the operator clicks Revoke themselves.
- Mainnet. Base Sepolia only — same as the rest of the demo-target.
- Approving from any wallet other than `DEMO_WALLET`. The connected-wallet path is a separate flow not covered here.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Cycle depth | **Light replay (option A)** — same proxy, new V2 impl, new tx | Fast (~30s), produces a real new alert per run, and the cumulative `previousUpgrades[]` history is useful color during the pitch. Full `cycle` would burn ~3–5 min of Sepolia gas per pitch and break ENS pinning. |
| Trigger for "fresh impl" | **Bump `VIGIL_DEMO_BUILD` constant in `DemoTokenV2.sol`** | The constant is already in V2 specifically to defeat OZ's bytecode-dedup so each run produces a new impl address. Existing `previousUpgrades[]` entries confirm this is the established pattern. |
| Wallet whose approval gets armed | **`DEMO_WALLET`** | Banner falls back to `DEMO_WALLET` when no external wallet is connected. Operator instructs audience to view the page with no wallet connected; no audience-side wallet setup needed. |
| Allowance amount | **`MaxUint256`** | Matches existing `seed-demo-wallet.ts`. Maximum drama in the "your wallet is exposed" framing. |
| Orchestration shape | **Single Hardhat run, inlined logic** (not shell-chained `npm run upgrade && npm run seed-demo-wallet`) | `trigger-upgrade.ts` early-returns when `v2ImplAddress` is set; chaining would require pre-mutating the deployments JSON before the second run. One Hardhat run = atomic, single signer init, lower latency. |
| Skill format | **Both** — `npm run demo-cycle` + `.claude/skills/demo-cycle/SKILL.md` | The npm script is what the operator runs in a terminal during a live pitch (no LLM in the loop, predictable). The skill exists so when Claude is in the session the operator can say "do the demo cycle" and get the same flow plus alert-file + on-chain verification. |
| Sourcify verification | **Keep best-effort, like trigger-upgrade.ts** | Vigil's pipeline reads compiler version + source from Sourcify for the contract-meta panel. Skipping verify would leave gaps in subsequent pitch runs. Failure is non-fatal (script logs and continues). |
| Existing scripts | **Untouched** — `trigger-upgrade.ts` and `seed-demo-wallet.ts` still work as-is | New script duplicates ~80% of their bodies. Keeping them lets per-step debugging (and the existing day-of-deploy flow) keep working. |
| Auto-commit | **No** | Repo rules require explicit operator authorization for any git commit. Script logs which files changed so the operator can stage/commit deliberately. |

## Architecture

### New files

```
demo-target/scripts/demo-cycle.ts         # orchestration script
.claude/skills/demo-cycle/SKILL.md        # Claude-invokable wrapper
docs/superpowers/specs/2026-05-09-demo-cycle-design.md  # this doc
```

### Touched files

| File | Touched by | What changes |
|---|---|---|
| `demo-target/package.json` | spec install (one-time) | Adds `"demo-cycle": "hardhat run scripts/pitch-cycle.ts --network baseSepolia"` to `scripts`. |
| `demo-target/contracts/DemoTokenV2.sol` | `pitch-cycle.ts` (every run) | `VIGIL_DEMO_BUILD = "<new ISO timestamp>"` rewritten in place. |
| `demo-target/deployments/base-sepolia.json` | `pitch-cycle.ts` (every run) | Existing `v2ImplAddress` / `upgradedAt` / `upgradeTxHash` / `upgradeBlockNumber` moved into `previousUpgrades[]`; new values written at the top level. |
| `demo-target/.openzeppelin/base-sepolia.json` | `prepareUpgrade` (every run) | OZ plugin appends new impl entry. |

## `pitch-cycle.ts` — flow

The script runs as a Hardhat task on `baseSepolia`. Single signer; `DEMO_WALLET_PRIVATE_KEY` is loaded for the approve step.

1. **Preflight**
   - Read `deployments/base-sepolia.json`; require `proxyAddress` and `v1ImplAddress`. If missing → fatal: "no proxy on file; run `npm run deploy` first".
   - Require `DEMO_WALLET_PRIVATE_KEY` and `DEMO_SPENDER_ADDRESS` in `.env`; spender must match `/^0x[a-fA-F0-9]{40}$/`.
   - Read `DEMO_WALLET` ETH balance; warn (non-fatal) if below `0.005 ETH`.
   - Stat `data/alerts-base-sepolia.json` (relative to repo root); warn if missing — implies the watcher isn't running, so step-7 verification by the skill will fail.

2. **Bump build stamp**
   - Read `contracts/DemoTokenV2.sol`, regex-replace the line `string public constant VIGIL_DEMO_BUILD = "...";` with the current ISO timestamp (`new Date().toISOString()`).
   - Write back. Fatal if the regex matches zero or >1 times (signals contract drift).

3. **Compile**
   - `await hre.run("compile")`. Fatal on error.

4. **Archive prior upgrade in deployments JSON**
   - If `record.v2ImplAddress` is set: push `{ v2ImplAddress, upgradedAt, upgradeTxHash, upgradeBlockNumber, note: "demo-cycle replay" }` into `record.previousUpgrades[]` (creating the array if absent), then `delete` those four top-level fields.
   - Write the file. (Now `trigger-upgrade.ts` would also work; we're inlining for atomicity.)

5. **Deploy fresh V2 impl + upgrade proxy**
   - `upgrades.prepareUpgrade(proxyAddress, V2Factory, { kind: "uups", unsafeSkipStorageCheck: true })` → `v2ImplAddress`.
   - `await proxy.upgradeToAndCall(v2ImplAddress, "0x")`.
   - On receipt: write `v2ImplAddress`, `upgradedAt: new Date().toISOString()`, `upgradeTxHash: receipt.hash`, `upgradeBlockNumber: receipt.blockNumber` back into the deployments JSON.

6. **Sourcify verify (best-effort)**
   - `hre.run("verify:verify", { address: v2ImplAddress, constructorArguments: [] })`.
   - Catch + log a warning on failure; don't abort. Print the manual re-run command (mirrors `trigger-upgrade.ts`).

7. **Approve from DEMO_WALLET**
   - Build a `Wallet(DEMO_WALLET_PRIVATE_KEY, ethers.provider)`.
   - Mint top-up: if `balanceOf(DEMO_WALLET) < 100 DEMO`, mint the difference from the deployer signer (matches `seed-demo-wallet.ts`). Idempotent — typical re-run is a no-op since balance survives upgrades.
   - `tokenAsDemo.approve(DEMO_SPENDER, MaxUint256)` → wait for receipt.
   - **Read-back with retry**: read `allowance(DEMO_WALLET, DEMO_SPENDER)` immediately. If `0n`, retry up to 3× with 2s backoff. Fatal if still `0n` after retries (real failure, not stale RPC).

8. **Summary block**
   ```
   [demo-cycle] proxy:           0x6595…21AD
   [demo-cycle] new V2 impl:     0x….
   [demo-cycle] upgrade tx:      0x….
   [demo-cycle] upgrade block:   N
   [demo-cycle] DEMO_WALLET:     0x6Dc4…8BA5
   [demo-cycle] allowance:       MaxUint256
   [demo-cycle] modified files:  contracts/DemoTokenV2.sol, deployments/base-sepolia.json
   [demo-cycle] next: open the UI on Base Sepolia, disconnect any wallet, click Revoke.
   ```

### Failure recovery

If the script is killed between step 4 and step 5, the deployments JSON has the prior upgrade archived but no top-level `v2ImplAddress`. The next `npm run demo-cycle` invocation re-runs steps 1-4 idempotently (step 4 finds no top-level fields to archive and is a no-op) and proceeds to deploy a fresh V2.

If killed between step 5 and step 7, the upgrade is already on-chain but `DEMO_WALLET` may not have an active allowance. The next run wastes one upgrade tx (gas spend), but produces a working state. The operator can also rescue by running `npm run seed-demo-wallet` standalone.

## `.claude/skills/demo-cycle/SKILL.md` — flow

Skill is a rigid checklist (TDD-style "follow exactly"), not flexible. The numbered steps map 1:1 to TodoWrite items so they show progress live during a pitch.

```
---
name: demo-cycle
description: Run the demo cycle to re-arm Vigil's revoke banner before a pitch — bumps the V2 build stamp, redeploys + upgrades on Base Sepolia, re-approves DEMO_WALLET → DEMO_SPENDER, and verifies the banner is armed. Use when the operator says "demo cycle", "arm the demo", "prep the pitch", or before any live pitch run.
---
```

Steps Claude executes when the skill is invoked:

1. **Run the script.** `cd demo-target && npm run demo-cycle 2>&1`. Stream output to the operator. Capture the new `upgradeTxHash` from the summary line.
2. **Verify the alert lands.** Poll `data/alerts-base-sepolia.json` every 5 s for up to 60 s. Pass condition: an entry with `chainId === 84532` and `txHash === <captured>`. On timeout: warn the operator that the watcher might not be running, but continue.
3. **Verify the allowance.** Read `allowance(DEMO_WALLET, DEMO_SPENDER)` on the proxy via Hardhat console (or `cast call`). Pass condition: > 0. Fatal on fail.
4. **Print the go/no-go.** Either:
   - `Banner armed on alert tx 0x…. Open the UI on Base Sepolia, disconnect any wallet, click Revoke.`
   - or a clear failure summary pointing at which step broke.

The skill never auto-commits, never opens a browser, never tries to drive the UI.

## Testing

This is operational tooling against Base Sepolia, so traditional unit tests don't apply. Verification before the first real pitch:

1. **Cold run** from current state (post-upgrade, allowance just revoked by hand): `npm run demo-cycle` → confirm summary shows new impl/tx, allowance > 0, and `data/alerts-base-sepolia.json` gains the new tx.
2. **Hot re-run**: immediately invoke `demo-cycle` a second time → confirm previous run's V2 lands in `previousUpgrades[]`, fresh impl + tx + approval all succeed.
3. **Skill path**: invoke the `demo-cycle` skill in Claude → confirm it captures the right tx hash, polls the alerts file, and surfaces the go-message.
4. **Failure path**: kill the watcher, run the skill → confirm the alert-file timeout warning is clear and the script's on-chain steps still completed.
5. **UI smoke**: load the Vigil app on Base Sepolia with no wallet connected → confirm the new alert card carries the red "Your wallet is exposed" banner; click Revoke; confirm allowance drops to 0 and the green "Approval revoked" state shows.

## Open questions

None at spec time. Two assumptions explicit so they can be challenged later:

- **Watcher is running locally during pitches.** If pitches happen against a remote-hosted watcher, the alerts file path needs to point at that deployment's data directory (or the skill needs to hit an HTTP endpoint instead). Re-spec if this changes.
- **Demo runs on Base Sepolia only.** If a future pitch uses Base mainnet for the live demo, the script needs a `--network` flag and matching deployment-file paths.
