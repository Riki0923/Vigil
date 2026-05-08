import { loadAlerts } from "@/lib/load-alerts";
import { type Alert } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { UpgradesChart, type ChartBucket } from "./components/UpgradesChart";
import { AlertList } from "./components/AlertList";

export const dynamic = "force-dynamic";

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

export default async function Home() {
  const { alerts, source, updatedAt } = await loadAlerts();
  const blockNumbers = alerts
    .map((a) => a.blockNumber)
    .filter((b): b is number => typeof b === "number");
  const latestBlock = blockNumbers.length > 0 ? Math.max(...blockNumbers) : null;

  const totalUpgrades = alerts.length;
  const criticalAlerts = alerts.filter((a) => a.severity === "CRITICAL").length;
  const unverifiedContracts = alerts.filter((a) => !a.isVerified).length;
  const chartData = buildChartData(alerts);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 font-bold">
              V
            </div>
            <div>
              <h1 className="font-semibold tracking-tight text-zinc-50">Vigil</h1>
              <p className="text-xs text-zinc-500">Vigil never sleeps</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
              <span className="text-zinc-500">{source === "live" ? "live" : "mock"}</span>
              <span className="text-zinc-700">·</span>
              <span
                className={`pulse-glow inline-block h-2 w-2 shrink-0 rounded-full ${
                  source === "live" ? "bg-green-500" : "bg-amber-500"
                }`}
              />
              <span className="text-zinc-300">
                Watching <span className="font-medium text-zinc-100">Base</span>
              </span>
              {latestBlock !== null && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="font-mono block-number-live">
                    block {latestBlock.toLocaleString()}
                  </span>
                </>
              )}
              {source === "live" && updatedAt && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="font-mono text-zinc-500">
                    updated {relativeTime(updatedAt)}
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
            <h2 className="text-2xl font-semibold tracking-tight">Alerts</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {alerts.length} upgrade{alerts.length === 1 ? "" : "s"} detected on Base
              {source === "mock" && (
                <span className="ml-2 rounded-md bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300 border border-amber-900">
                  showing mock data — agent hasn&apos;t emitted yet
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-3">
          <StatCard label="Total Upgrades Detected" value={totalUpgrades} />
          <StatCard label="Critical Alerts" value={criticalAlerts} accent="red" />
          <StatCard label="Unverified Contracts" value={unverifiedContracts} accent="amber" />
        </div>

        <div className="mb-6">
          <UpgradesChart data={chartData} />
        </div>

        <AlertList alerts={alerts} />

        <footer className="mt-12 flex items-center justify-between border-t border-zinc-900 pt-6 text-xs text-zinc-600">
          <span>Built for ETHPrague 2026</span>
          <span className="font-mono">vigil-agent.eth</span>
        </footer>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "red" | "amber";
}) {
  const numberColor =
    accent === "red"
      ? "text-red-400"
      : accent === "amber"
        ? "text-amber-400"
        : "text-zinc-100";
  const topLine =
    accent === "red"
      ? "bg-red-500/25"
      : accent === "amber"
        ? "bg-amber-500/25"
        : "bg-zinc-700/40";
  const borderColor =
    accent === "red"
      ? "border-zinc-800 hover:border-red-900/60"
      : accent === "amber"
        ? "border-zinc-800 hover:border-amber-900/60"
        : "border-zinc-800";

  return (
    <div
      className={`relative overflow-hidden rounded-lg border ${borderColor} bg-zinc-900/40 px-5 py-4 transition-colors`}
    >
      <div className={`absolute inset-x-0 top-0 h-px ${topLine}`} />
      <div className={`font-mono text-3xl font-bold tabular-nums leading-none ${numberColor}`}>
        {value}
      </div>
      <div className="mt-2 text-xs leading-tight text-zinc-500">{label}</div>
    </div>
  );
}
