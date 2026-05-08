"use client";

import { useState } from "react";
import {
  abiSignature,
  isExactMatch,
  isFullPipelineRawData,
  isPartialMatch,
  isUnverifiedRawData,
  type Alert,
  type FullPipelineRawData,
  type ModifiedFunction,
  type RiskFlag,
  type RiskLevel,
  type SimilarContract,
} from "@/lib/types";
import {
  basescanAddressUrl,
  basescanTxUrl,
  chainName,
  relativeTime,
  severityClasses,
  truncateAddress,
  truncateHash,
} from "@/lib/format";
import { CopyButton } from "./CopyButton";
import { ChatPanel } from "./ChatPanel";

export function AlertList({ alerts }: { alerts: Alert[] }) {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-3">
        {alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onAskAI={() => setSelectedAlert(alert)}
          />
        ))}
      </ul>

      {selectedAlert && (
        <ChatPanel
          key={selectedAlert.id}
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
        />
      )}
    </>
  );
}

function AlertCard({ alert, onAskAI }: { alert: Alert; onAskAI: () => void }) {
  const fullPipeline = isFullPipelineRawData(alert.rawData) ? alert.rawData : null;
  const unverified = isUnverifiedRawData(alert.rawData) ? alert.rawData : null;

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
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-sm font-semibold text-zinc-100">{alert.message}</h3>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={onAskAI}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800"
              >
                Ask AI
              </button>
              <button
                disabled
                className="inline-flex cursor-not-allowed items-center gap-1 rounded border border-zinc-800 px-2 py-0.5 text-xs text-zinc-600 opacity-50"
                title="Swarm integration coming soon"
              >
                Swarm <span className="text-zinc-700">↗</span>
              </button>
              <time className="text-xs text-zinc-500">{relativeTime(alert.timestamp)}</time>
            </div>
          </div>

          {fullPipeline?.natSpec?.title && (
            <p className="mt-1 text-xs text-zinc-500">
              <span className="font-mono text-zinc-400">{fullPipeline.natSpec.title}</span>
              {fullPipeline.natSpec.notice && <span> — {fullPipeline.natSpec.notice}</span>}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {!alert.isVerified && <Tag tone="critical">unverified source</Tag>}
            {alert.isVerified && !alert.hasStorageLayout && (
              <Tag tone="warn">no storage layout</Tag>
            )}
            {alert.isVerified && alert.hasStorageLayout && (
              <Tag tone="info">verified · layout available</Tag>
            )}
            {fullPipeline && isPartialMatch(fullPipeline.matchType) && (
              <Tag tone="warn">partial match — bytecode modified</Tag>
            )}
            {fullPipeline && isExactMatch(fullPipeline.matchType) && (
              <Tag tone="info">exact match</Tag>
            )}
            {fullPipeline?.storageDiff && fullPipeline.storageDiff.movedVariables.length > 0 && (
              <Tag tone="critical">
                {fullPipeline.storageDiff.movedVariables.length} moved (collision)
              </Tag>
            )}
            {fullPipeline?.abiDiff && fullPipeline.abiDiff.removedFunctions.length > 0 && (
              <Tag tone="warn">−{fullPipeline.abiDiff.removedFunctions.length} fn</Tag>
            )}
            {fullPipeline?.abiDiff && fullPipeline.abiDiff.addedFunctions.length > 0 && (
              <Tag tone="info">+{fullPipeline.abiDiff.addedFunctions.length} fn</Tag>
            )}
            {fullPipeline?.abiDiff && fullPipeline.abiDiff.modifiedFunctions.length > 0 && (
              <Tag tone="warn">~{fullPipeline.abiDiff.modifiedFunctions.length} fn</Tag>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-0.5">
              <a
                href={basescanAddressUrl(alert.proxyAddress)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:text-zinc-300 transition-colors"
              >
                proxy {truncateAddress(alert.proxyAddress)}
              </a>
              <CopyButton text={alert.proxyAddress} />
            </span>

            <span className="text-zinc-700">→</span>

            <span className="inline-flex items-center gap-0.5">
              <a
                href={basescanAddressUrl(alert.implementationAddress)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:text-zinc-300 transition-colors"
              >
                impl {truncateAddress(alert.implementationAddress)}
              </a>
              <CopyButton text={alert.implementationAddress} />
            </span>

            <span className="text-zinc-700">·</span>

            <span className="inline-flex items-center gap-0.5">
              <a
                href={basescanTxUrl(alert.txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:text-zinc-300 transition-colors"
              >
                tx {truncateHash(alert.txHash)}
              </a>
              <CopyButton text={alert.txHash} />
            </span>

            {typeof alert.blockNumber === "number" && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="font-mono">block {alert.blockNumber.toLocaleString()}</span>
              </>
            )}
            {fullPipeline?.contractMeta?.compilerVersion && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="font-mono">
                  {fullPipeline.contractMeta.compilerVersion.split("+")[0]}
                </span>
              </>
            )}
          </div>

          {fullPipeline?.functionRiskFlags && fullPipeline.functionRiskFlags.length > 0 && (
            <div className="mt-3 space-y-1">
              {fullPipeline.functionRiskFlags.map((flag, i) => (
                <RiskFlagRow key={i} flag={flag} />
              ))}
            </div>
          )}

          {unverified && unverified.similarContracts.length > 0 && (
            <SimilarContractsSection contracts={unverified.similarContracts} />
          )}

          {fullPipeline?.storageDiff &&
            (fullPipeline.storageDiff.movedVariables.length > 0 ||
              fullPipeline.storageDiff.removedVariables.length > 0 ||
              fullPipeline.storageDiff.addedVariables.length > 0) && (
              <StorageDiffSection diff={fullPipeline.storageDiff} />
            )}

          {fullPipeline?.abiDiff &&
            (fullPipeline.abiDiff.addedFunctions.length > 0 ||
              fullPipeline.abiDiff.removedFunctions.length > 0 ||
              fullPipeline.abiDiff.modifiedFunctions.length > 0) && (
              <ABIDiffSection diff={fullPipeline.abiDiff} />
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

function RiskFlagRow({ flag }: { flag: RiskFlag }) {
  const dotColor: Record<RiskLevel, string> = {
    CRITICAL: "bg-red-500",
    HIGH: "bg-orange-500",
    MEDIUM: "bg-amber-500",
  };
  const textColor: Record<RiskLevel, string> = {
    CRITICAL: "text-red-300",
    HIGH: "text-orange-300",
    MEDIUM: "text-amber-300",
  };
  return (
    <div className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs">
      <span
        className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotColor[flag.level]}`}
      />
      <span
        className={`font-mono text-[10px] uppercase tracking-wider shrink-0 ${textColor[flag.level]}`}
      >
        {flag.level}
      </span>
      <span className="text-zinc-300">{flag.message}</span>
    </div>
  );
}

function SimilarContractsSection({ contracts }: { contracts: SimilarContract[] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-zinc-500 transition hover:text-zinc-300">
        Similar contracts ({contracts.length}) — Sourcify bytecode similarity
      </summary>
      <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
        <ul className="space-y-1 text-xs font-mono text-zinc-400">
          {contracts.map((c) => {
            const high = c.similarity >= 0.9;
            return (
              <li key={c.address} className="flex items-center gap-3">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    high ? "bg-red-950/60 text-red-300" : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {c.similarity.toFixed(2)}
                </span>
                <span className="text-zinc-500">{chainName(c.chainId)}</span>
                <span>{truncateAddress(c.address)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

function StorageDiffSection({
  diff,
}: {
  diff: NonNullable<FullPipelineRawData["storageDiff"]>;
}) {
  return (
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
                  {v.label}: slot {v.oldSlot}+{v.oldOffset} → slot {v.newSlot}+{v.newOffset}
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
  );
}

function ABIDiffSection({ diff }: { diff: NonNullable<FullPipelineRawData["abiDiff"]> }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-zinc-500 transition hover:text-zinc-300">
        ABI diff
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
        {diff.removedFunctions.length > 0 && (
          <div>
            <div className="mb-1 text-amber-300">removed ({diff.removedFunctions.length})</div>
            <ul className="space-y-0.5 font-mono text-zinc-400">
              {diff.removedFunctions.map((f, i) => (
                <li key={`r-${i}`}>− {abiSignature(f)}</li>
              ))}
            </ul>
          </div>
        )}
        {diff.addedFunctions.length > 0 && (
          <div>
            <div className="mb-1 text-zinc-300">added ({diff.addedFunctions.length})</div>
            <ul className="space-y-0.5 font-mono text-zinc-400">
              {diff.addedFunctions.map((f, i) => (
                <li key={`a-${i}`}>+ {abiSignature(f)}</li>
              ))}
            </ul>
          </div>
        )}
        {diff.modifiedFunctions.length > 0 && (
          <div>
            <div className="mb-1 text-amber-300">modified ({diff.modifiedFunctions.length})</div>
            <ul className="space-y-0.5 font-mono text-zinc-400">
              {diff.modifiedFunctions.map((m: ModifiedFunction, i: number) => (
                <li key={`m-${i}`}>
                  {m.name}: {abiSignature(m.old)} → {abiSignature(m.new)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
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
