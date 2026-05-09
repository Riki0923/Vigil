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
import type { TargetReputation } from "@/lib/ens";
import { ENS_CONFIG } from "@/lib/ens";
import {
  basescanAddressUrl,
  basescanTxUrl,
  chainName,
  relativeTime,
  severityClasses,
  truncateAddress,
  truncateHash,
} from "@/lib/format";
import { demoProxyForChain } from "@/lib/wallet";
import { CopyButton } from "./CopyButton";
import { ChatPanel } from "./ChatPanel";

function isVigilDemoTarget(alert: Alert): boolean {
  const chainId = alert.chainId;
  if (typeof chainId !== "number") return false;
  const demoProxy = demoProxyForChain(chainId);
  if (!demoProxy) return false;
  return alert.proxyAddress.toLowerCase() === demoProxy.toLowerCase();
}

export function AlertList({
  alerts,
  targetReputations = {},
}: {
  alerts: Alert[];
  targetReputations?: Record<string, TargetReputation>;
}) {
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-3">
        {alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            reputation={
              alert.proxyName ? targetReputations[alert.proxyName] ?? null : null
            }
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

function AlertCard({
  alert,
  reputation,
  onAskAI,
}: {
  alert: Alert;
  reputation: TargetReputation | null;
  onAskAI: () => void;
}) {
  const fullPipeline = isFullPipelineRawData(alert.rawData) ? alert.rawData : null;
  const unverified = isUnverifiedRawData(alert.rawData) ? alert.rawData : null;

  return (
    <li className="card group rounded-lg p-5">
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
            <h3 className="text-brand truncate text-sm font-semibold">{alert.message}</h3>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={onAskAI}
                className="btn-brand inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs"
              >
                <span aria-hidden="true">✦</span>
                Ask AI
              </button>
              <button
                disabled
                className="btn-brand-ghost inline-flex cursor-not-allowed items-center gap-1 rounded px-2 py-0.5 text-xs opacity-50"
                title="Swarm integration coming soon"
              >
                Swarm <span>↗</span>
              </button>
              <time className="text-brand-soft text-xs">{relativeTime(alert.timestamp)}</time>
            </div>
          </div>

          {fullPipeline?.natSpec?.title && (
            <p className="text-brand-soft mt-1 text-xs">
              <span className="font-mono text-brand">{fullPipeline.natSpec.title}</span>
              {fullPipeline.natSpec.notice && <span> — {fullPipeline.natSpec.notice}</span>}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {isVigilDemoTarget(alert) && (
              <Tag tone="critical">★ Vigil demo target</Tag>
            )}
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

          <div className="text-brand-soft mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="inline-flex items-center gap-0.5">
              <a
                href={basescanAddressUrl(alert.proxyAddress)}
                target="_blank"
                rel="noreferrer"
                className="font-mono transition-colors hover:text-brand"
              >
                {alert.proxyName ? (
                  <>
                    <span className="text-brand">{alert.proxyName}</span>
                    <span className="text-brand-soft"> ({truncateAddress(alert.proxyAddress)})</span>
                  </>
                ) : (
                  <>proxy {truncateAddress(alert.proxyAddress)}</>
                )}
              </a>
              <CopyButton text={alert.proxyAddress} />
            </span>

            <span className="text-brand-soft">→</span>

            <span className="inline-flex items-center gap-0.5">
              <a
                href={basescanAddressUrl(alert.implementationAddress)}
                target="_blank"
                rel="noreferrer"
                className="font-mono transition-colors hover:text-brand"
              >
                impl {truncateAddress(alert.implementationAddress)}
              </a>
              <CopyButton text={alert.implementationAddress} />
            </span>

            <span className="text-brand-soft">·</span>

            <span className="inline-flex items-center gap-0.5">
              <a
                href={basescanTxUrl(alert.txHash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono transition-colors hover:text-brand"
              >
                tx {truncateHash(alert.txHash)}
              </a>
              <CopyButton text={alert.txHash} />
            </span>

            {typeof alert.blockNumber === "number" && (
              <>
                <span className="text-brand-soft">·</span>
                <span className="font-mono">block {alert.blockNumber.toLocaleString()}</span>
              </>
            )}
            {fullPipeline?.contractMeta?.compilerVersion && (
              <>
                <span className="text-brand-soft">·</span>
                <span className="font-mono">
                  {fullPipeline.contractMeta.compilerVersion.split("+")[0]}
                </span>
              </>
            )}
          </div>

          {reputation && <EnsReputationPanel reputation={reputation} />}

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
              <summary className="text-brand-soft cursor-pointer text-xs transition hover:text-brand">
                AI assessment ·{" "}
                <span className="font-mono">{alert.analysis.confidence} confidence</span>
              </summary>
              <div className="brand-border mt-2 space-y-2 rounded-md border bg-white/60 p-3 text-xs leading-relaxed text-brand">
                <p>
                  <span className="font-semibold">Summary. </span>
                  {alert.analysis.summary}
                </p>
                <p>
                  <span className="font-semibold">Explanation. </span>
                  {alert.analysis.explanation}
                </p>
                <p>
                  <span className="font-semibold">Recommendation. </span>
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
    CRITICAL: "var(--severity-critical)",
    HIGH: "var(--severity-high)",
    MEDIUM: "var(--severity-medium)",
  };
  const tagClass: Record<RiskLevel, string> = {
    CRITICAL: "sev-critical",
    HIGH: "sev-high",
    MEDIUM: "sev-medium",
  };
  return (
    <div className="brand-border flex items-start gap-2 rounded-md border bg-white/50 px-3 py-1.5 text-xs">
      <span
        className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: dotColor[flag.level] }}
      />
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tagClass[flag.level]} border`}
      >
        {flag.level}
      </span>
      <span className="text-brand">{flag.message}</span>
    </div>
  );
}

function SimilarContractsSection({ contracts }: { contracts: SimilarContract[] }) {
  return (
    <details className="mt-3">
      <summary className="text-brand-soft cursor-pointer text-xs transition hover:text-brand">
        Similar contracts ({contracts.length}) — Sourcify bytecode similarity
      </summary>
      <div className="brand-border mt-2 rounded-md border bg-white/60 p-3">
        <ul className="text-brand space-y-1 text-xs font-mono">
          {contracts.map((c) => {
            const high = c.similarity >= 0.9;
            return (
              <li key={c.address} className="flex items-center gap-3">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] border ${
                    high ? "sev-critical" : "sev-low"
                  }`}
                >
                  {c.similarity.toFixed(2)}
                </span>
                <span className="text-brand-soft">{chainName(c.chainId)}</span>
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
      <summary className="text-brand-soft cursor-pointer text-xs transition hover:text-brand">
        Storage diff
      </summary>
      <div className="brand-border mt-2 space-y-2 rounded-md border bg-white/60 p-3 text-xs">
        {diff.movedVariables.length > 0 && (
          <div>
            <div
              className="mb-1 font-semibold"
              style={{ color: "var(--severity-critical)" }}
            >
              moved ({diff.movedVariables.length})
            </div>
            <ul className="text-brand space-y-0.5 font-mono">
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
            <div
              className="mb-1 font-semibold"
              style={{ color: "var(--severity-high)" }}
            >
              removed ({diff.removedVariables.length})
            </div>
            <ul className="text-brand space-y-0.5 font-mono">
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
            <div
              className="mb-1 font-semibold"
              style={{ color: "var(--severity-low)" }}
            >
              added ({diff.addedVariables.length})
            </div>
            <ul className="text-brand space-y-0.5 font-mono">
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
      <summary className="text-brand-soft cursor-pointer text-xs transition hover:text-brand">
        ABI diff
      </summary>
      <div className="brand-border mt-2 space-y-2 rounded-md border bg-white/60 p-3 text-xs">
        {diff.removedFunctions.length > 0 && (
          <div>
            <div
              className="mb-1 font-semibold"
              style={{ color: "var(--severity-high)" }}
            >
              removed ({diff.removedFunctions.length})
            </div>
            <ul className="text-brand space-y-0.5 font-mono">
              {diff.removedFunctions.map((f, i) => (
                <li key={`r-${i}`}>− {abiSignature(f)}</li>
              ))}
            </ul>
          </div>
        )}
        {diff.addedFunctions.length > 0 && (
          <div>
            <div
              className="mb-1 font-semibold"
              style={{ color: "var(--severity-low)" }}
            >
              added ({diff.addedFunctions.length})
            </div>
            <ul className="text-brand space-y-0.5 font-mono">
              {diff.addedFunctions.map((f, i) => (
                <li key={`a-${i}`}>+ {abiSignature(f)}</li>
              ))}
            </ul>
          </div>
        )}
        {diff.modifiedFunctions.length > 0 && (
          <div>
            <div
              className="mb-1 font-semibold"
              style={{ color: "var(--severity-medium)" }}
            >
              modified ({diff.modifiedFunctions.length})
            </div>
            <ul className="text-brand space-y-0.5 font-mono">
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

function EnsReputationPanel({ reputation }: { reputation: TargetReputation }) {
  const sevClass =
    reputation.lastSeverity === "CRITICAL"
      ? "sev-critical"
      : reputation.lastSeverity === "HIGH"
        ? "sev-high"
        : reputation.lastSeverity === "MEDIUM"
          ? "sev-medium"
          : reputation.lastSeverity === "LOW"
            ? "sev-low"
            : "border-[var(--brand-navy)]/15 bg-white/70 text-brand";

  const ensAppUrl = `${ENS_CONFIG.appUrlBase}/${reputation.name}?network=${ENS_CONFIG.networkParam}`;

  return (
    <details
      open
      className="mt-3 rounded-md border-l-2 border-l-[var(--brand-navy)] bg-white/70 px-3 py-2 text-xs shadow-sm"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 transition-colors hover:text-brand list-none">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--severity-low)] pulse-glow" />
          <span className="text-brand-soft uppercase tracking-wider text-[10px]">
            ENS reputation
          </span>
        </span>
        <span className="font-mono font-semibold text-brand">{reputation.name}</span>
        {reputation.upgradeCount > 0 && (
          <span className="brand-border-soft rounded border bg-white px-1.5 py-0.5 text-[10px] font-mono text-brand">
            {reputation.upgradeCount} upgrade{reputation.upgradeCount === 1 ? "" : "s"} tracked
          </span>
        )}
        {reputation.lastSeverity && (
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase ${sevClass}`}>
            last {reputation.lastSeverity}
          </span>
        )}
        {reputation.kind && (
          <span className="text-brand-soft text-[10px] font-mono">{reputation.kind}</span>
        )}
      </summary>

      <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {reputation.baseSepoliaAddress && (
          <KV label={ENS_CONFIG.baseAddrLabel}>
            <span className="font-mono">{truncateAddress(reputation.baseSepoliaAddress)}</span>
          </KV>
        )}
        {reputation.lastUpgradeAt && (
          <KV label="vigil.last-upgrade-at">
            <span className="font-mono">{relativeTime(reputation.lastUpgradeAt)}</span>
          </KV>
        )}
        {reputation.lastTx && (
          <KV label="vigil.last-tx">
            <a
              href={basescanTxUrl(reputation.lastTx)}
              target="_blank"
              rel="noreferrer"
              className="font-mono transition-colors hover:text-brand hover:underline"
            >
              {truncateHash(reputation.lastTx)} ↗
            </a>
          </KV>
        )}
        {reputation.upgradeCount > 0 && (
          <KV label="vigil.upgrade-count">
            <span className="font-mono">{reputation.upgradeCount}</span>
          </KV>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-brand-soft">
        <span>resolved live from {ENS_CONFIG.networkLabel} ENS · written back by the agent after each alert</span>
        <span>·</span>
        <a
          href={ensAppUrl}
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-brand hover:underline"
        >
          view on ENS app ↗
        </a>
      </div>
    </details>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-brand-soft uppercase tracking-wider text-[10px] shrink-0">{label}</span>
      <span className="text-brand">{children}</span>
    </div>
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
      ? "sev-critical"
      : tone === "warn"
        ? "sev-medium"
        : "border-[var(--brand-navy)]/15 bg-white/70 text-brand";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {children}
    </span>
  );
}
