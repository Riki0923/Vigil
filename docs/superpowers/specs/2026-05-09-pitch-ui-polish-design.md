# Pitch UI Polish — Narrative Strip + Hero Threat Banner

**Date:** 2026-05-09
**Status:** Design — pending plan
**Scope:** Frontend (`frontend/app/` + `frontend/lib/`)

## Goal

Make the dashboard tell a clear story at a glance and dramatize the revoke moment for the ETHPrague pitch. Two changes, one cohesive direction:

1. **Narrative strip (always visible)** — replace the 3 generic stat cards with a single horizontal strip that reads like a headline: *"3 critical in last 24h → demo.vigil.eth (most recent) · 12 upgrades tracked · agent.vigil.eth"*.
2. **Hero threat banner (conditional)** — when the connected/demo wallet has an active approval on a proxy that just got upgraded, a full-width red banner appears between the header and the strip with a primary `Revoke now` CTA.

Both are scoped to the existing dashboard route (`frontend/app/page.tsx`) and use the existing brand tokens (`globals.css`).

## Non-goals

- No changes to the watcher/agent, alert pipeline, or data layer.
- No new chains or RPC plumbing — Base mainnet only (testnet was already hidden in commit `3ed83b6`).
- No general UI refactor — only the hero banner area, the strip, and minor adjustments inside `AlertCard` for consistency.
- Logs DX work (emojis, structured prefixes) is a **separate spec**, to be written after this ships.

## User-visible behavior

### SAFE state (no active exposure)

```text
┌─ header (logo · connect · chain · live indicator) ─────────────┐
├─ NARRATIVE STRIP (cream surface) ──────────────────────────────┤
│   12 upgrades · 24h    →   aave.vigil.eth   12m ago            │
│                            exact match                          │
│   agent: agent.vigil.eth         right-aligned meta            │
├─ AgentIdentityCard (unchanged) ────────────────────────────────┤
├─ UpgradesChart (unchanged) ────────────────────────────────────┤
└─ AlertList (unchanged) ────────────────────────────────────────┘
```

The big number on the left is **navy** (brand color), with the label *"upgrades · 24h"*. If there are critical alerts in the last 24h, the number turns **red** and the label switches to *"critical · 24h"*.

### EXPOSED state (active approval on upgraded proxy)

```text
┌─ header ───────────────────────────────────────────────────────┐
├─ HERO THREAT BANNER (red gradient, full-width) ────────────────┤
│   ⚠  YOUR WALLET IS EXPOSED                                    │
│      Approval activa en demo.vigil.eth — la nueva impl puede   │
│      mover tus tokens.            [ Revoke now ]               │
├─ NARRATIVE STRIP ──────────────────────────────────────────────┤
│   3 critical · 24h     →   demo.vigil.eth   2m ago             │
│                            storage collision                    │
├─ AgentIdentityCard ────────────────────────────────────────────┤
└─ ...                                                            │
```

Hero banner is **sticky to the top of the main scroll container** (below the page header) so it follows when the user scrolls into the alert list.

### Revoke flow (within the hero)

1. User clicks `Revoke now` → button enters `Sending tx…` state.
2. Tx submitted → button becomes `Mining…` with mini explorer link.
3. Tx mined → banner crossfades to **green success** state for 5s: *"Approval revoked · allowance is now 0"*.
4. After 5s → banner fades out → dashboard falls back to SAFE state on next render.

Failures show inline error text inside the banner (`failed — see console`), preserving the existing logging pattern.

## Trigger logic for the hero

Hero banner renders only when **all four** are true:

1. `NEXT_PUBLIC_DEMO_PROXY_BASE` env var is set and parses as an address (already true in `.env.local` after this session).
2. The current `viewChainId` matches the chain where the demo proxy lives (Base mainnet, `8453`).
3. There is at least one alert in `allAlerts` with `proxyAddress === DEMO_PROXY_BASE` and `chainId === viewChainId`.
4. `useDemoAllowance` returns a non-zero allowance for `(owner=connected || DEMO_WALLET, spender=DEMO_SPENDER, proxy=DEMO_PROXY_BASE)`.

This mirrors the gate inside the existing `RevokeBanner` (`frontend/app/components/RevokeBanner.tsx`) — we are **lifting** that gate out of `AlertCard` and into the page-level hero.

## Components

### New: `HeroThreatBanner.tsx`

Path: `frontend/app/components/HeroThreatBanner.tsx`. Client component.

**Props:**

```ts
type HeroThreatBannerProps = {
  alerts: Alert[];           // pre-filtered to viewChainId
  ensProxyOverride?: string | null;
};
```

**Responsibility:** evaluate the four trigger conditions, find the matching alert (most recent if multiple), render the banner with the revoke CTA. Internally reuses the same revoke transaction logic that lives in the current `RevokeBanner.tsx` (refactor: extract a `useRevokeApproval` hook so both the hero and any future caller can share it — see "Refactor" below).

Dismissable: **no**. The banner is informational and only goes away when the threat is gone (allowance == 0). This is intentional — we don't want users to "x" away a real risk.

### New: `NarrativeStrip.tsx`

Path: `frontend/app/components/NarrativeStrip.tsx`. Client component (it derives its content from already-loaded alert data, no async).

**Props:**

```ts
type NarrativeStripProps = {
  alerts: Alert[];           // pre-filtered to viewChainId
  agentIdentity: AgentIdentity | null;
};
```

**Computed fields:**

- `criticalCount24h` — alerts where `severity === "CRITICAL"` and `timestamp` within last 24h.
- `totalCount24h` — alerts in last 24h regardless of severity.
- `mostRecentAlert` — sort by timestamp desc, take first.
- `tracked` — `alerts.length` total (or pull from `agentIdentity.capabilities.watch.length` if available).

**Visual:** single rounded card on `--surface-0`, horizontal flex layout, three slots (big number + label, "→ most recent + summary", right-aligned meta).

If `criticalCount24h > 0`, the big number is `--severity-critical`; otherwise `--brand-navy`. Label changes correspondingly (`critical · 24h` vs `upgrades · 24h`).

### Modified: `Dashboard.tsx`

Replace this block (lines 163-167):

```tsx
<div className="mb-5 grid grid-cols-3 gap-3">
  <StatCard label="Total Upgrades Detected" value={totalUpgrades} />
  <StatCard label="Critical Alerts" value={criticalAlerts} accent="critical" />
  <StatCard label="Unverified Contracts" value={unverifiedContracts} accent="high" />
</div>
```

With:

```tsx
<HeroThreatBanner alerts={alerts} />
<NarrativeStrip alerts={alerts} agentIdentity={agentIdentity} />
```

The local `StatCard` component and the `totalUpgrades` / `criticalAlerts` / `unverifiedContracts` derivations are removed. The `chartData` derivation stays (used by `UpgradesChart`).

### Modified: `AlertList.tsx` / `AlertCard.tsx`

The embedded `<RevokeBanner>` inside each `AlertCard` is **removed** (currently at `frontend/app/components/AlertList.tsx:215-219`). The hero handles the revoke action globally; duplicating the CTA per card creates ambiguity. The alert that triggered the hero gets a small visual hint instead — a `★ active threat` chip in the alert card's tag row, matching the existing `Tag` component pattern.

### Refactor: `useRevokeApproval` hook

Extract the revoke transaction logic from `RevokeBanner.tsx` and add it as an exported hook in the existing `frontend/lib/approvals.ts` (which already houses `useDemoAllowance` and `hasActiveApproval` — same domain, flat structure matches the rest of `frontend/lib/`):

```ts
export function useRevokeApproval(opts: {
  proxyAddress?: Address;
  spender?: Address;
  owner?: Address;
  chainId: number;
}): {
  state: "idle" | "sending" | "mining" | "mined" | "error";
  txHash?: `0x${string}`;
  error?: string;
  revoke: () => Promise<void>;
};
```

This hook owns the `writeContractAsync` / `privateKeyToAccount` branching and tx-receipt waiting. Both the hero and (if we ever bring it back) the in-card banner can subscribe to it.

`RevokeBanner.tsx` is **deleted** after the hero replaces its functionality. (Rationale: the file's only consumers are the hero and the per-card banner, both replaced/removed.)

## Data flow

1. `frontend/app/page.tsx` (server) calls `loadAlerts()` and `resolveAgentIdentity()` as today.
2. `<Dashboard>` (client, wrapped in `<ViewChainProvider>`) receives `allAlerts` + `agentIdentity` + `targetReputations`.
3. `Dashboard.tsx` filters by `viewChainId` (already today) → passes `alerts` to both `<HeroThreatBanner>` and `<NarrativeStrip>`.
4. `<HeroThreatBanner>` runs its four-condition gate; renders nothing if any condition fails.
5. `<NarrativeStrip>` always renders (it has no gate).

No new data sources, no new API routes, no new env vars (we already set `NEXT_PUBLIC_DEMO_PROXY_BASE` this session).

## Error handling

- **No alerts at all:** narrative strip renders with `0 upgrades · 24h` and `—` for the most-recent slot. Hero is hidden (no matching alert).
- **Allowance fetch fails:** hero hides (treat as "not exposed" — fail safe).
- **Revoke tx fails:** hero stays in error state with `failed — see console`, allowance query refetches in 30s.
- **Wallet not connected and no `DEMO_WALLET_PRIVATE_KEY`:** hero shows the CTA but clicking shows the inline `NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY not set` error (current behavior, preserved).

## Visual / brand details

- Strip: `--surface-0` background, `--border-soft` border, padding `12px 16px`, `border-radius: 10px`.
- Hero: red linear gradient (`#fbd5d0 → #f0a097`), 2px solid `--severity-critical` border, padding `14px 16px`, `border-radius: 10px`, `box-shadow: 0 4px 16px rgba(231,76,60,0.25)`.
- Hero CTA: solid `--severity-critical`, white text, `box-shadow: 0 2px 8px rgba(231,76,60,0.4)`, scales to `transform: translateY(1px)` on press.
- Hero icon: 32px circle with `⚠` glyph, `--severity-critical` background, white glyph.
- Both elements share the existing `mb-5` / `mb-6` rhythm of the dashboard.

## Testing

This is a UI change with conditional rendering. Verification approach:

1. **Local SAFE state:** unset `NEXT_PUBLIC_DEMO_PROXY_BASE` → reload → confirm strip renders, hero is absent.
2. **Local EXPOSED state:** run `npm run demo-cycle:mainnet` to re-arm an active approval → reload → confirm hero appears with non-zero allowance, strip's big number is red.
3. **Revoke happy path:** click `Revoke now` → confirm button cycles `Sending → Mining → success` → after 5s the banner disappears and the strip's big number turns navy again.
4. **Lint + build:** `npm run lint` + `npm run build` clean from the `frontend/` directory.

No unit tests are added; the existing project has none and these components are integration-heavy (wallet, RPC, on-chain reads) — the demo-cycle script IS our integration test.

## Out of scope (future work)

- Logs DX (emojis + structured prefixes) — separate spec.
- Multi-proxy hero (when multiple proxies have active approvals) — defer; demo only has one.
- Animations beyond the 5s success crossfade — defer.
- Mobile layout — pitch is on desktop; punt mobile until post-pitch.
