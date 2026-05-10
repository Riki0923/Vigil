"use client";

import Image from "next/image";
import { useMemo } from "react";
import type { Alert } from "@/lib/types";
import type { AgentIdentity, TargetReputation } from "@/lib/ens";
import { TimeAgo } from "./TimeAgo";
import { SUPPORTED_CHAINS } from "@/lib/wallet";
import { AlertList } from "./AlertList";
import { AgentIdentityCard } from "./AgentIdentityCard";
import { UpgradesChart, type ChartBucket } from "./UpgradesChart";
import { ConnectButton } from "./ConnectButton";
import { ChainSelector } from "./ChainSelector";
import { HeroThreatBanner } from "./HeroThreatBanner";
import { DemoControlsCard } from "./DemoControlsCard";
import { NarrativeStrip } from "./NarrativeStrip";
import { useViewChain } from "./ViewChainContext";

function buildChartData(alerts: Alert[]): ChartBucket[] {
  const now = new Date();
  const currentHour = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0,
    0,
    0,
  );

  const buckets = Array.from({ length: 24 }, (_, i) => {
    const hoursAgo = 23 - i;
    const start = currentHour.getTime() - hoursAgo * 3_600_000;
    const end = start + 3_600_000;
    const label = `${new Date(start).getHours().toString().padStart(2, "0")}:00`;
    return { label, count: 0, isCurrent: hoursAgo === 0, start, end };
  });

  for (const alert of alerts) {
    const ts = new Date(alert.timestamp).getTime();
    for (const bucket of buckets) {
      if (ts >= bucket.start && ts < bucket.end) {
        bucket.count++;
        break;
      }
    }
  }

  return buckets.map(({ label, count, isCurrent }) => ({ label, count, isCurrent }));
}

export function Dashboard({
  allAlerts,
  source,
  updatedAt,
  agentIdentity = null,
  targetReputations = {},
}: {
  allAlerts: Alert[];
  source: "live" | "mock";
  updatedAt?: string;
  agentIdentity?: AgentIdentity | null;
  targetReputations?: Record<string, TargetReputation>;
}) {
  const { viewChainId } = useViewChain();

  const alerts = useMemo(
    () => allAlerts.filter((a) => (a.chainId ?? SUPPORTED_CHAINS.base.id) === viewChainId),
    [allAlerts, viewChainId],
  );

  const blockNumbers = alerts
    .map((a) => a.blockNumber)
    .filter((b): b is number => typeof b === "number");
  const latestBlock = blockNumbers.length > 0 ? Math.max(...blockNumbers) : null;

  const chartData = buildChartData(alerts);

  const chainLabel =
    viewChainId === SUPPORTED_CHAINS.base.id
      ? SUPPORTED_CHAINS.base.name
      : SUPPORTED_CHAINS.baseSepolia.name;

  return (
    <div className="flex flex-1 flex-col">
        <header className="brand-border surface-1/90 sticky top-0 z-10 border-b backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Image
                src="/vigil-logo.png"
                alt="Vigil"
                width={64}
                height={64}
                className="h-11 w-11 object-contain"
                priority
              />
              <p className="font-display hidden text-xs italic tracking-wide text-brand-soft sm:block">
                Vigil never sleeps
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <ConnectButton />
              <ChainSelector />
              <div className="brand-border flex items-center gap-2 rounded-full border bg-white/60 px-3 py-1.5">
                <span className="text-brand-soft uppercase tracking-wider text-[10px]">
                  {source === "live" ? "live" : "mock"}
                </span>
                <span
                  className={`pulse-glow inline-block h-2 w-2 shrink-0 rounded-full ${
                    source === "live"
                      ? "bg-[var(--severity-low)]"
                      : "bg-[var(--severity-medium)]"
                  }`}
                />
                {latestBlock !== null && (
                  <span className="font-mono block-number-live">
                    block {latestBlock.toLocaleString()}
                  </span>
                )}
                {source === "live" && updatedAt && (
                  <>
                    <span className="text-brand-soft">·</span>
                    <span className="font-mono text-brand-soft">
                      updated <TimeAgo iso={updatedAt} />
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-display text-3xl font-bold tracking-tight text-brand">
                  Alerts
                </h2>
                <span className="severity-rail" aria-hidden="true">
                  <span style={{ background: "var(--severity-low)" }} />
                  <span style={{ background: "var(--severity-medium)" }} />
                  <span style={{ background: "var(--severity-high)" }} />
                  <span style={{ background: "var(--severity-critical)" }} />
                </span>
              </div>
              <p className="text-brand-soft mt-1 text-sm">
                {alerts.length} upgrade{alerts.length === 1 ? "" : "s"} detected on {chainLabel}
                {source === "mock" && (
                  <span
                    className="sev-medium ml-2 rounded-md border px-2 py-0.5 text-xs"
                  >
                    showing mock data — agent hasn&apos;t emitted yet
                  </span>
                )}
              </p>
            </div>
          </div>

          <HeroThreatBanner alerts={alerts} />

          <DemoControlsCard alerts={alerts} />

          <NarrativeStrip alerts={alerts} agentIdentity={agentIdentity} />

          <AgentIdentityCard identity={agentIdentity} />

          <div className="mb-6">
            <UpgradesChart data={chartData} />
          </div>

          <AlertList alerts={alerts} targetReputations={targetReputations} />

          <footer className="brand-border-soft mt-12 flex items-center justify-between border-t pt-6 text-xs text-brand-soft">
            <span className="font-display italic">Built for ETHPrague 2026</span>
            <span className="font-mono">agent.vigil.eth</span>
          </footer>
        </main>
    </div>
  );
}

