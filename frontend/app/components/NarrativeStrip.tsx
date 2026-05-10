"use client";

import { useMemo, useState } from "react";
import type { Alert } from "@/lib/types";
import type { AgentIdentity } from "@/lib/ens";
import { TimeAgo } from "./TimeAgo";

const DAY_MS = 24 * 60 * 60 * 1000;

function summarizeAlert(alert: Alert): string {
  const sev = alert.severity.toLowerCase();
  if (alert.severity === "CRITICAL" || alert.severity === "HIGH") {
    if (!alert.isVerified) return `${sev} · unverified impl`;
    if (!alert.hasStorageLayout) return `${sev} · no storage layout`;
  }
  if (alert.message) {
    return alert.message.length > 60
      ? alert.message.slice(0, 57) + "…"
      : alert.message;
  }
  return `${sev} upgrade detected`;
}

export function NarrativeStrip({
  alerts,
  agentIdentity,
}: {
  alerts: Alert[];
  agentIdentity: AgentIdentity | null;
}) {
  // Captured once on mount to avoid impure `Date.now()` during render.
  // "Last 24h" is anchored at mount time, fine for pitch flows.
  const [nowMs] = useState(() => Date.now());

  const stats = useMemo(() => {
    const cutoff = nowMs - DAY_MS;
    const last24h = alerts.filter(
      (a) => new Date(a.timestamp).getTime() >= cutoff,
    );
    const critical24h = last24h.filter((a) => a.severity === "CRITICAL").length;
    const sorted = [...alerts].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const mostRecent = sorted[0] ?? null;
    return {
      total24h: last24h.length,
      critical24h,
      mostRecent,
      tracked: alerts.length,
    };
  }, [alerts, nowMs]);

  const headlineNumber = stats.critical24h > 0 ? stats.critical24h : stats.total24h;
  const headlineLabel =
    stats.critical24h > 0 ? "critical · 24h" : "upgrades · 24h";
  const headlineColor =
    stats.critical24h > 0 ? "var(--severity-critical)" : "var(--brand-navy)";

  return (
    <div className="brand-border-soft surface-0 mb-6 rounded-lg border px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="shrink-0">
          <div
            className="font-display text-3xl font-bold leading-none tabular-nums"
            style={{ color: headlineColor }}
          >
            {headlineNumber}
          </div>
          <div className="text-brand-soft mt-1.5 text-[10px] uppercase tracking-wider">
            {headlineLabel}
          </div>
        </div>

        <div className="text-brand-soft text-base">→</div>

        <div className="min-w-0 flex-1">
          {stats.mostRecent ? (
            <>
              <div className="text-brand truncate text-sm font-semibold">
                {stats.mostRecent.proxyName ?? "most recent upgrade"}
              </div>
              <div className="text-brand-soft mt-0.5 truncate text-xs">
                {summarizeAlert(stats.mostRecent)} ·{" "}
                <TimeAgo iso={stats.mostRecent.timestamp} />
              </div>
            </>
          ) : (
            <div className="text-brand-soft text-xs">no upgrades detected yet</div>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className="text-brand-soft text-[11px]">
            {stats.tracked} upgrade{stats.tracked === 1 ? "" : "s"} tracked
          </div>
          {agentIdentity?.name && (
            <div className="text-brand-soft mt-0.5 font-mono text-[11px]">
              agent: {agentIdentity.name}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
