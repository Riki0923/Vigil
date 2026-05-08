import { loadAlerts } from "@/lib/load-alerts";
import { isDiffResult, type Alert } from "@/lib/types";
import {
  basescanAddressUrl,
  basescanTxUrl,
  relativeTime,
  severityClasses,
  truncateAddress,
  truncateHash,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { alerts, source, updatedAt } = await loadAlerts();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 font-bold">
              V
            </div>
            <div>
              <h1 className="font-semibold tracking-tight text-zinc-50">
                Vigil
              </h1>
              <p className="text-xs text-zinc-500">Vigil never sleeps</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5">
              <span
                className={`pulse-glow inline-block h-2 w-2 rounded-full ${
                  source === "live" ? "bg-green-500" : "bg-amber-500"
                }`}
              />
              <span className="text-zinc-300">
                {source === "live" ? "Live" : "Mock data"}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-300">
                Watching{" "}
                <span className="font-medium text-zinc-100">Base Sepolia</span>
              </span>
              {source === "live" && updatedAt && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="font-mono text-zinc-400">
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
              {alerts.length} upgrade{alerts.length === 1 ? "" : "s"} detected
              on Base Sepolia
              {source === "mock" && (
                <span className="ml-2 rounded-md bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300 border border-amber-900">
                  showing mock data — agent hasn&apos;t emitted yet
                </span>
              )}
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </ul>

        <footer className="mt-12 flex items-center justify-between border-t border-zinc-900 pt-6 text-xs text-zinc-600">
          <span>Built for ETHPrague 2026</span>
          <span className="font-mono">vigil-agent.eth</span>
        </footer>
      </main>
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const diff = isDiffResult(alert.rawData) ? alert.rawData : null;

  return (
    <li className="group rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-zinc-700 hover:bg-zinc-900/70">
      <div className="flex items-start gap-4">
        <span
          className={`inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${severityClasses(
            alert.severity,
          )}`}
        >
          {alert.severity}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate text-sm font-semibold text-zinc-100">
              {alert.message}
            </h3>
            <time className="shrink-0 text-xs text-zinc-500">
              {relativeTime(alert.timestamp)}
            </time>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {!alert.isVerified && (
              <Tag tone="critical">unverified source</Tag>
            )}
            {alert.isVerified && !alert.hasStorageLayout && (
              <Tag tone="warn">no storage layout</Tag>
            )}
            {alert.isVerified && alert.hasStorageLayout && (
              <Tag tone="info">verified · layout available</Tag>
            )}
            {diff && diff.movedVariables.length > 0 && (
              <Tag tone="critical">
                {diff.movedVariables.length} moved (collision)
              </Tag>
            )}
            {diff && diff.removedVariables.length > 0 && (
              <Tag tone="warn">−{diff.removedVariables.length} vars</Tag>
            )}
            {diff && diff.addedVariables.length > 0 && (
              <Tag tone="info">+{diff.addedVariables.length} vars</Tag>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-500">
            <a
              href={basescanAddressUrl(alert.proxyAddress)}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-zinc-300"
            >
              proxy {truncateAddress(alert.proxyAddress)}
            </a>
            <span className="text-zinc-700">→</span>
            <a
              href={basescanAddressUrl(alert.implementationAddress)}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-zinc-300"
            >
              impl {truncateAddress(alert.implementationAddress)}
            </a>
            <span className="text-zinc-700">·</span>
            <a
              href={basescanTxUrl(alert.txHash)}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-zinc-300"
            >
              tx {truncateHash(alert.txHash)}
            </a>
          </div>

          {diff && (diff.movedVariables.length > 0 || diff.removedVariables.length > 0 || diff.addedVariables.length > 0) && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-500 transition hover:text-zinc-300">
                Storage diff
              </summary>
              <div className="mt-2 space-y-2 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
                {diff.movedVariables.length > 0 && (
                  <div>
                    <div className="mb-1 text-red-300">moved ({diff.movedVariables.length})</div>
                    <ul className="space-y-0.5 font-mono text-zinc-400">
                      {diff.movedVariables.map((v) => (
                        <li key={v.label}>
                          {v.label}: slot {v.oldSlot}+{v.oldOffset} → slot{" "}
                          {v.newSlot}+{v.newOffset}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {diff.removedVariables.length > 0 && (
                  <div>
                    <div className="mb-1 text-amber-300">removed ({diff.removedVariables.length})</div>
                    <ul className="space-y-0.5 font-mono text-zinc-400">
                      {diff.removedVariables.map((v) => (
                        <li key={v.label}>
                          {v.label} (slot {v.slot}, type {v.type})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {diff.addedVariables.length > 0 && (
                  <div>
                    <div className="mb-1 text-zinc-300">added ({diff.addedVariables.length})</div>
                    <ul className="space-y-0.5 font-mono text-zinc-400">
                      {diff.addedVariables.map((v) => (
                        <li key={v.label}>
                          {v.label} (slot {v.slot}, type {v.type})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}

          {alert.analysis && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-zinc-500 transition hover:text-zinc-300">
                AI assessment ·{" "}
                <span className="font-mono">{alert.analysis.confidence} confidence</span>
              </summary>
              <div className="mt-2 space-y-2 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs leading-relaxed text-zinc-400">
                <p>
                  <span className="text-zinc-200">Summary. </span>
                  {alert.analysis.summary}
                </p>
                <p>
                  <span className="text-zinc-200">Explanation. </span>
                  {alert.analysis.explanation}
                </p>
                <p>
                  <span className="text-zinc-200">Recommendation. </span>
                  {alert.analysis.recommendation}
                </p>
              </div>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: "info" | "warn" | "critical";
  children: React.ReactNode;
}) {
  const classes =
    tone === "critical"
      ? "bg-red-950/60 text-red-300 border-red-900"
      : tone === "warn"
        ? "bg-amber-950/60 text-amber-300 border-amber-900"
        : "bg-zinc-800/60 text-zinc-300 border-zinc-700";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {children}
    </span>
  );
}
