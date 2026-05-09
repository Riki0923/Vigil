# Logs DX — Emoji Helpers with ANSI / CSS Colors

**Date:** 2026-05-10
**Status:** Design — pending implementation
**Scope:** User-owned files only — `frontend/lib/*` and `demo-target/scripts/*`. Kristian's `src/*` (agent, watcher, sourcify, swarm, alerts, delivery, ens, apify) is **untouched**.

## Goal

Make every log line in user-owned scripts and frontend lib visually scannable at a glance:

- An emoji prefix that telegraphs *what kind of event this is* (lifecycle, network, success, warning, error, hint).
- The existing `[scope]` bracket preserved so output stays distinguishable when interleaved with Hardhat / wagmi / watcher output.
- Color around the emoji + scope on Node terminals (ANSI) and browser console (`%c` CSS) — gray body text stays default.

Style picked from brainstorm options A/B/C: **B** (emoji + brackets, minimal diff) **plus colors**.

Example output:

```text
🚀 [demo-cycle] starting on baseMainnet (chainId 8453)
⚠️  [demo-cycle] DEMO_WALLET balance 0.0015 ETH (< 0.005)
⚙️  [demo-cycle] compiling contracts…
📦 [demo-cycle] new V2 impl: 0x7654c5…4cb7
📡 [demo-cycle] upgrade tx: 0x4a8462…d60a (block 45784356)
✅ [demo-cycle] V2 impl verified on Sourcify
🔐 [demo-cycle] approving DEMO_SPENDER for MaxUint256…
✅ [demo-cycle] allowance: MaxUint256
💡 [demo-cycle] next: open the UI on Base mainnet, click Revoke
```

## Non-goals

- No changes to anything in `src/*` (Kristian's territory). His `[Apify]`, `[Apify X402]`, `[Pipeline]`, `[UpgradeWatcher]`, `[Telegram]`, `[Swarm]`, `[Vigil/ENS]` prefixes stay untouched.
- No changes to `scripts/ens/*` (mixed ownership — defer).
- No log-level system, no JSON output, no shipping logs to a server. Plain `console.*` calls.

## Categories (12 emoji)

| Emoji | Helper method | When to use | Color (ANSI / CSS) |
|---|---|---|---|
| 🚀 | `log.start(msg)` | Lifecycle: script started, listener bound | green |
| ⚙️  | `log.step(msg)` | Work in progress: compiling, waiting | cyan |
| 📦 | `log.deploy(msg)` | Contract deployed / address printed | blue |
| 🔐 | `log.sign(msg)` | Approving / signing tx | cyan |
| 📡 | `log.tx(msg)` | Tx submitted / mined / receipt | cyan |
| ✅ | `log.ok(msg)` | Success / verified | green |
| ⚠️  | `log.warn(msg)` | Non-fatal issue (low gas, missing optional env) | yellow |
| ❌ | `log.error(msg, err?)` | Fatal / threw / failed | red |
| 📊 | `log.info(msg)` | Stats / counts / summary | gray |
| 💡 | `log.hint(msg)` | Next step for the operator | magenta |
| 🌱 | `log.seed(msg)` | Seeding wallet / state | green |
| 🧹 | `log.reset(msg)` | Cleanup / file removed | gray |

`log.error` accepts an optional second `err` argument and forwards it to `console.error` so the stack trace renders.

## Helpers (two files)

### `demo-target/scripts/lib/log.ts` — Node only

ANSI escape codes only. Approx 60 LOC.

```ts
const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

export function makeLogger(scope: string) {
  const tag = (emoji: string, color: string) =>
    `${color}${emoji}${C.reset} ${C.gray}[${scope}]${C.reset}`;
  return {
    start:  (m: string) => console.log(`${tag("🚀", C.green)}   ${m}`),
    step:   (m: string) => console.log(`${tag("⚙️", C.cyan)}    ${m}`),
    deploy: (m: string) => console.log(`${tag("📦", C.blue)}   ${m}`),
    sign:   (m: string) => console.log(`${tag("🔐", C.cyan)}   ${m}`),
    tx:     (m: string) => console.log(`${tag("📡", C.cyan)}   ${m}`),
    ok:     (m: string) => console.log(`${tag("✅", C.green)}   ${m}`),
    warn:   (m: string) => console.warn(`${tag("⚠️", C.yellow)}    ${m}`),
    error:  (m: string, err?: unknown) =>
      err !== undefined
        ? console.error(`${tag("❌", C.red)}   ${m}`, err)
        : console.error(`${tag("❌", C.red)}   ${m}`),
    info:   (m: string) => console.log(`${tag("📊", C.gray)}   ${m}`),
    hint:   (m: string) => console.log(`${tag("💡", C.magenta)}   ${m}`),
    seed:   (m: string) => console.log(`${tag("🌱", C.green)}   ${m}`),
    reset:  (m: string) => console.log(`${tag("🧹", C.gray)}   ${m}`),
  };
}
```

`NO_COLOR` env var support: if `process.env.NO_COLOR` is set, the ANSI codes are stripped (so logs in CI / file redirects stay clean). Implementation: wrap `C` so each color returns `""` when `NO_COLOR` is set.

### `frontend/lib/log.ts` — browser + SSR

Branches on `typeof window`:

- **Server (Node):** same ANSI output as the demo-target helper.
- **Browser:** `%c` CSS to color the `emoji [scope]` segment, body text stays default.

```ts
const isServer = typeof window === "undefined";

const ANSI = { /* same palette */ };
const CSS = {
  green: "color: #16a34a; font-weight: 600",
  yellow: "color: #ca8a04; font-weight: 600",
  red: "color: #dc2626; font-weight: 600",
  blue: "color: #2563eb; font-weight: 600",
  cyan: "color: #0891b2; font-weight: 600",
  magenta: "color: #9333ea; font-weight: 600",
  gray: "color: #64748b; font-weight: 600",
};

export function makeLogger(scope: string) {
  const fmt = (emoji: string, ansi: string, css: string, msg: string) =>
    isServer
      ? [`${ansi}${emoji}${ANSI.reset} ${ANSI.gray}[${scope}]${ANSI.reset}   ${msg}`]
      : [`%c${emoji} [${scope}]%c   ${msg}`, css, "color: inherit; font-weight: normal"];
  // ... returns object with start/step/etc using fmt
}
```

Note: in SSR, the `console.log` output reaches Next's terminal (already true today). Hydration warnings are unaffected — these helpers don't render to the DOM.

## Refactor plan — 7 files

The helper is a per-scope factory. Each file calls `makeLogger("<scope>")` once at the top, then replaces every `console.log("[scope] …")` with `log.<method>("…")`.

| File | Logs today | After |
|---|---|---|
| `demo-target/scripts/demo-cycle.ts` | 33 `console.log/warn` | `const log = makeLogger("demo-cycle")` + categorized calls |
| `demo-target/scripts/deploy-proxy.ts` | 16 | `makeLogger("deploy-proxy")` |
| `demo-target/scripts/seed-demo-wallet.ts` | 17 | `makeLogger("seed")` |
| `demo-target/scripts/trigger-upgrade.ts` | 19 | `makeLogger("trigger-upgrade")` |
| `demo-target/scripts/reset.ts` | 4 | `makeLogger("reset")` |
| `frontend/lib/load-alerts.ts` | 13 | `makeLogger("loadAlerts")` |
| `frontend/lib/approvals.ts` (`useRevokeApproval`) | 8 | `makeLogger("useRevokeApproval")` |

Mapping each existing message to a category is a per-line judgment call. The rough heuristic:

- `console.error` → `log.error`
- `console.warn` → `log.warn`
- "starting", "listening", "init" → `log.start`
- "compiling", "waiting", "checking" → `log.step`
- contract address output → `log.deploy`
- tx hash output / receipt → `log.tx`
- "approve", "sign" → `log.sign`
- "verified", "mined", "ok", "complete" → `log.ok`
- counts, summary, "returning N" → `log.info`
- "next: …", actionable instruction for the operator → `log.hint`

Multi-line block prefixes like `[Pipeline] ── Upgrade detected ──` stay verbatim (those are Kristian's, in `src/`, out of scope).

## Existing prefix names — preserved

- `[demo-cycle]`, `[deploy-proxy]`, `[seed]`, `[trigger-upgrade]`, `[reset]` — unchanged
- `[loadAlerts]` — unchanged
- `[useRevokeApproval]` — unchanged

This keeps the diff small and grep-friendly. Anyone doing `grep "\[demo-cycle\]"` continues to find the same lines.

## Color compatibility

- **macOS Terminal / iTerm2:** ANSI fully supported. Emoji color rendering may add tinge but base color shows.
- **VSCode integrated terminal:** ANSI supported.
- **CI logs / file redirect:** `NO_COLOR=1` strips codes.
- **Chrome DevTools console:** `%c` CSS supported.
- **Safari console:** `%c` CSS supported, occasionally renders weight differently.

## Testing

- **Lint:** `npm run lint` from `frontend/`. Hardhat-side scripts compile through `tsc` in `npm run typecheck`.
- **Manual smoke:** run `npm run demo-cycle:mainnet` — confirm output looks like the example block at the top.
- **Browser:** open http://localhost:3000 with dev server running — confirm `[loadAlerts]` and `[useRevokeApproval]` lines render with colored emoji + scope segment.
- **NO_COLOR:** `NO_COLOR=1 npm run reset` — confirm no ANSI escapes leak.

## Out of scope (deferred)

- Kristian's surfaces (`src/*`). If he wants to adopt the same helper later, the public API is stable: `makeLogger(scope)` returning an object with the 12 methods.
- A shared logger between Node and frontend (would require workspace setup or duplication today). Two near-identical files is the right trade-off for now.
- Log levels (DEBUG/INFO/WARN/ERROR), structured JSON output, log shipping. None of these are pitch-relevant.
