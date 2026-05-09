"use client";

import type { AgentIdentity } from "@/lib/ens";
import { ENS_CONFIG } from "@/lib/ens";

const SEVERITY_CHIP: Record<string, string> = {
  LOW: "sev-low",
  MEDIUM: "sev-medium",
  HIGH: "sev-high",
  CRITICAL: "sev-critical",
};

function truncate(s: string, head = 12, tail = 8): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function AgentIdentityCard({ identity }: { identity: AgentIdentity | null }) {
  if (!identity) {
    return (
      <div className="brand-border-soft mb-5 rounded-lg border bg-white/40 px-5 py-4 text-xs text-brand-soft">
        <span className="font-mono">SEPOLIA_RPC_URL</span> not configured —
        agent identity not resolvable from ENS in this environment.
      </div>
    );
  }

  const ensAppUrl = `${ENS_CONFIG.appUrlBase}/${identity.name}?network=sepolia`;
  const severityChipClass = identity.severityMin
    ? SEVERITY_CHIP[identity.severityMin] ?? "sev-medium"
    : "sev-medium";

  return (
    <div className="card mb-5 rounded-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-brand-soft">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--severity-low)] pulse-glow" />
            <span>Agent Identity · resolved live from Ethereum Sepolia ENS</span>
          </div>

          <div className="mt-2 flex items-baseline gap-3">
            <h3 className="font-display text-2xl font-bold tracking-tight text-brand">
              {identity.name}
            </h3>
            <a
              href={ensAppUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand-soft transition-colors hover:text-brand"
            >
              view on ENS app ↗
            </a>
          </div>

          {identity.description && (
            <p className="mt-1 text-sm text-brand">{identity.description}</p>
          )}

          {identity.url && (
            <a
              href={identity.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs font-mono text-brand-soft transition-colors hover:text-brand"
            >
              {identity.url} ↗
            </a>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {identity.severityMin && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-brand-soft uppercase tracking-wider text-[10px]">
                  severity floor
                </span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase ${severityChipClass}`}
                >
                  {identity.severityMin}
                </span>
              </span>
            )}

            {identity.capabilities && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-brand-soft uppercase tracking-wider text-[10px]">
                  capabilities
                </span>
                <CapabilitiesChips caps={identity.capabilities} />
              </span>
            )}
          </div>

          {identity.feed && (
            <div className="brand-border-soft mt-4 flex items-center gap-2 rounded-md border bg-white/60 px-3 py-2 text-xs">
              <span className="text-brand-soft uppercase tracking-wider text-[10px] shrink-0">
                vigil.feed
              </span>
              <a
                href={identity.feed}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-brand transition-colors hover:underline"
                title={identity.feed}
              >
                {truncate(identity.feed.replace("https://", ""), 28, 18)} ↗
              </a>
              <span className="text-brand-soft ml-auto text-[10px] shrink-0">
                subscribers discover via ENS
              </span>
            </div>
          )}

          {identity.payment && (
            <div className="brand-border-soft mt-2 flex items-center gap-2 rounded-md border bg-white/60 px-3 py-2 text-xs">
              <span className="text-brand-soft uppercase tracking-wider text-[10px] shrink-0">
                vigil.payment
              </span>
              <span className="font-mono text-brand truncate" title={identity.payment}>
                {identity.payment}
              </span>
              <span className="text-brand-soft ml-auto text-[10px] shrink-0">
                X402 endpoint, discoverable via ENS
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CapabilitiesChips({ caps }: { caps: { watch: string[]; chains: string[]; output: string[] } }) {
  const chip = (s: string, idx: number) => (
    <span
      key={idx}
      className="brand-border-soft rounded border bg-white/70 px-1.5 py-0.5 text-[10px] font-mono text-brand"
    >
      {s}
    </span>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {caps.watch.map((w, i) => chip(`watch:${w}`, i))}
      {caps.chains.map((c, i) => chip(`chain:${c}`, 100 + i))}
      {caps.output.map((o, i) => chip(`out:${o}`, 200 + i))}
    </span>
  );
}
