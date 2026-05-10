"use client";

import { useMemo, useState } from "react";
import type { Alert } from "@/lib/types";
import {
  hasActiveApproval,
  useDemoAllowance,
  useRevokeApproval,
} from "@/lib/approvals";
import {
  DEMO_SPENDER,
  demoProxyForChain,
  explorerAddressUrl,
  explorerTxUrl,
  formatAllowance,
  shortenAddress,
} from "@/lib/wallet";
import { useViewChain } from "./ViewChainContext";
import { TimeAgo } from "./TimeAgo";

type Address = `0x${string}`;

export function HeroThreatBanner({ alerts }: { alerts: Alert[] }) {
  const { viewChainId } = useViewChain();
  const demoProxy = demoProxyForChain(viewChainId);

  const matchingAlert = useMemo(() => {
    if (!demoProxy) return null;
    const lower = demoProxy.toLowerCase();
    const matches = alerts.filter(
      (a) =>
        a.proxyAddress.toLowerCase() === lower &&
        (a.chainId ?? viewChainId) === viewChainId,
    );
    if (matches.length === 0) return null;
    return [...matches].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )[0];
  }, [alerts, demoProxy, viewChainId]);

  const [showSuccess, setShowSuccess] = useState(false);

  const { state, txHash, error, revoke, ownerAddress } = useRevokeApproval({
    chainId: viewChainId,
    proxyAddress: demoProxy,
    spender: DEMO_SPENDER,
    onSuccess: () => {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5_000);
      void allowanceQuery.refetch();
    },
  });

  const allowanceQuery = useDemoAllowance(
    viewChainId,
    matchingAlert ? (demoProxy as Address | undefined) : undefined,
    ownerAddress,
    DEMO_SPENDER,
  );

  const allowance = allowanceQuery.data;
  const hasThreat = hasActiveApproval(allowance);

  if (!matchingAlert || !demoProxy) return null;
  if (!hasThreat && !showSuccess) return null;

  if (showSuccess) {
    return (
      <div className="brand-border mb-5 rounded-lg border-2 border-emerald-300 bg-emerald-50 px-5 py-4 shadow-md transition-opacity">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-base text-white">
            ✓
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700/70">
              approval revoked
            </div>
            <div className="text-sm font-semibold text-emerald-800">
              Allowance is now 0 on {matchingAlert.proxyName ?? "this contract"}.
            </div>
          </div>
          {txHash && (
            <a
              href={explorerTxUrl(viewChainId, txHash)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] text-emerald-700/80 underline"
            >
              view tx ↗
            </a>
          )}
        </div>
      </div>
    );
  }

  const isBusy = state === "sending" || state === "mining";
  const buttonLabel =
    state === "sending"
      ? "Sending tx…"
      : state === "mining"
        ? "Mining…"
        : "Revoke now";

  const contractName = matchingAlert.proxyName ?? "this contract";
  const allowanceFmt =
    typeof allowance === "bigint" ? formatAllowance(allowance) : null;
  const sevTextStyle = { color: "var(--sev-critical-text)" } as const;
  const sevDimStyle = { color: "var(--sev-critical-text)", opacity: 0.75 } as const;

  return (
    <div
      className="mb-5 rounded-lg border-2 px-5 py-4 shadow-lg"
      style={{
        background: "linear-gradient(135deg, #fbd5d0 0%, #f0a097 100%)",
        borderColor: "var(--severity-critical)",
        boxShadow: "0 4px 16px rgba(231, 76, 60, 0.25)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ background: "var(--severity-critical)" }}
        >
          ⚠
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-[10px] font-bold uppercase tracking-widest"
            style={sevDimStyle}
          >
            your wallet is exposed
          </div>
          <div
            className="mt-0.5 text-sm font-bold leading-snug sm:text-base"
            style={sevTextStyle}
          >
            Active approval on {contractName} — the new implementation can move
            your tokens.
          </div>
        </div>
        <button
          onClick={revoke}
          disabled={isBusy}
          className="shrink-0 rounded-md px-4 py-2 text-sm font-bold text-white transition-transform active:translate-y-px disabled:opacity-60"
          style={{
            background: "var(--severity-critical)",
            boxShadow: "0 2px 8px rgba(231, 76, 60, 0.4)",
          }}
        >
          {buttonLabel}
        </button>
      </div>

      <div
        className="mt-3 ml-12 rounded-md border px-3 py-2 text-[11px]"
        style={{
          borderColor: "rgba(231, 76, 60, 0.35)",
          background: "rgba(255,255,255,0.35)",
        }}
      >
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono">
          <dt style={sevDimStyle}>contract</dt>
          <dd className="truncate" style={sevTextStyle}>
            <span className="font-bold">{contractName}</span>{" "}
            <a
              href={explorerAddressUrl(viewChainId, matchingAlert.proxyAddress)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {shortenAddress(matchingAlert.proxyAddress)} ↗
            </a>
          </dd>

          <dt style={sevDimStyle}>new impl</dt>
          <dd className="truncate" style={sevTextStyle}>
            <a
              href={explorerAddressUrl(viewChainId, matchingAlert.implementationAddress)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {shortenAddress(matchingAlert.implementationAddress)} ↗
            </a>{" "}
            <span style={sevDimStyle}>
              (deployed <TimeAgo iso={matchingAlert.timestamp} />)
            </span>
          </dd>

          <dt style={sevDimStyle}>allowance</dt>
          <dd style={sevTextStyle}>
            {allowanceFmt ? (
              <>
                <span className="font-bold">{allowanceFmt.label}</span>
                <div className="mt-0.5 text-[10px] font-normal" style={sevDimStyle}>
                  {allowanceFmt.detail}
                </div>
              </>
            ) : (
              <span style={sevDimStyle}>loading…</span>
            )}
          </dd>
        </dl>
      </div>

      {(txHash || error) && (
        <div className="mt-2 flex items-center gap-2 pl-12 text-[11px]">
          {txHash && (
            <a
              href={explorerTxUrl(viewChainId, txHash)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline"
              style={{ color: "var(--sev-critical-text)", opacity: 0.8 }}
            >
              view revoke tx ↗
            </a>
          )}
          {error && (
            <span
              className="font-mono"
              style={{ color: "var(--sev-critical-text)", opacity: 0.8 }}
              title={error}
            >
              failed — see console
            </span>
          )}
        </div>
      )}
    </div>
  );
}
