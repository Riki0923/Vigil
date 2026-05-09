---
name: demo-cycle
description: Re-arm Vigil's revoke banner before a pitch. Bumps the V2 build stamp, deploys a fresh impl, calls upgradeToAndCall on Base mainnet, and re-approves DEMO_WALLET → DEMO_SPENDER on the demo proxy. Verifies the allowance is active and that a fresh alert lands in the watcher's data file. Use when the operator says "demo cycle", "arm the demo", "prep the pitch", "redo the demo", or anything similar before a live pitch run.
---

# demo-cycle skill

Re-arm the Vigil "your wallet is exposed" revoke banner so a fresh pitch run has a working revoke flow.

## When to use

- Operator says "demo cycle", "arm the demo", "prep the pitch", "redo the demo", or anything that sounds like resetting the live-pitch state on Base mainnet.
- Before a fresh pitch, after a previous run where the operator already clicked Revoke.

## Steps

Follow these steps exactly, in order. Track each as a TodoWrite item so the operator sees progress live.

### 1. Run the orchestration script

Run from the repo root:

```bash
cd demo-target && npm run demo-cycle:mainnet 2>&1
```

Stream the output to the operator. Capture the new upgrade tx hash by scanning the output for the line that matches exactly:

```
[demo-cycle] upgrade tx:      0x<64 hex chars>
```

(Note: there are multiple spaces between `tx:` and the hash — the regex should be tolerant: `^\[demo-cycle\] upgrade tx:\s+(0x[a-fA-F0-9]{64})`.)

If the script exits non-zero: STOP, surface the error to the operator, and ask them to fix and re-run. Common failures:

- `No deployment record at …` → run `npm run deploy:mainnet` first.
- `Set DEMO_WALLET_PRIVATE_KEY in .env` → operator missed an env var; point at `demo-target/.env`.
- `allowance is still 0 after 3 retries` → real on-chain failure; check tx on Basescan and re-run.

If the script exits 0, allowance > 0 is already guaranteed on-chain (the script's own retry-loop hard-fails otherwise). The summary block's `allowance:` line confirms this for the operator.

### 2. Verify the alert lands

The watcher writes alerts to `data/alerts-base-mainnet.json` (relative to repo root). Poll for the captured tx hash:

- Read the file (it's JSON: either an array of alerts, or `{ alerts: [...] }`).
- Match an entry where `chainId === 8453` and `txHash` equals the captured hash.
- Interval: 5 s; Timeout: 60 s total.

If the entry shows up: pass.

If timeout: warn the operator that the watcher may not be running, but DO NOT FAIL — proceed to step 3. The on-chain state is what arms the banner; the alert file is a UI-side concern that catches up once the watcher is back.

### 3. Print the go message

If step 1 passed and step 2 found the alert:

```
✅ Banner armed on alert tx 0x….
   Open the UI on Base mainnet, disconnect any wallet, click Revoke.
```

If step 1 passed but step 2 timed out:

```
⚠️ Alert not yet seen in data/alerts-base-mainnet.json after 60s — watcher may not be running.
✅ Banner armed on-chain (script exit 0 + allowance: MaxUint256). Once the watcher catches up, the banner will appear in the UI.
   Open the UI on Base mainnet, disconnect any wallet, click Revoke.
```

## What this skill never does

- Auto-commit modified files (`contracts/DemoTokenV2.sol` and `deployments/base-mainnet.json` are mutated; the operator commits when they choose).
- Drive the UI or open a browser.
- Approve from any wallet other than `DEMO_WALLET` (the env-configured demo wallet, not the operator's connected wallet).
- Reset the proxy contract or touch ENS records.
- Skip step 1 to "save time" — even if the chain state already looks right, the operator wants a fresh alert per pitch.

## Sepolia variant (legacy/testing only)

The Sepolia setup still works (`npm run demo-cycle` without `:mainnet`, alerts file `data/alerts-base-sepolia.json`, chainId 84532). Use only when the operator explicitly asks for Sepolia — production demos run on Base mainnet.
