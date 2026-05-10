"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Alert } from "@/lib/types";
import {
  hasActiveApproval,
  useDemoAllowance,
} from "@/lib/approvals";
import {
  DEMO_SPENDER,
  DEMO_WALLET,
  demoProxyForChain,
  explorerAddressUrl,
  explorerTxUrl,
  shortenAddress,
} from "@/lib/wallet";
import { makeLogger } from "@/lib/log";
import { useViewChain } from "./ViewChainContext";

const log = makeLogger("DemoControlsCard");

type Address = `0x${string}`;

type CycleResult = {
  upgradeTxHash: string;
  v2ImplAddress: string;
  proxyAddress: string;
  allowance: "unlimited";
  chainId: number;
};

type CycleState =
  | { status: "idle" }
  | { status: "running"; startedAt: string }
  | { status: "done"; startedAt: string; completedAt: string; result: CycleResult }
  | { status: "error"; startedAt: string; completedAt: string; message: string };

const POLL_INTERVAL_MS = 2_000;

export function DemoControlsCard({ alerts }: { alerts: Alert[] }) {
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

  const allowanceQuery = useDemoAllowance(
    viewChainId,
    matchingAlert ? (demoProxy as Address | undefined) : undefined,
    DEMO_WALLET,
    DEMO_SPENDER,
  );
  const allowance = allowanceQuery.data;
  const hasThreat = hasActiveApproval(allowance);
  const allowanceConfirmedZero =
    typeof allowance === "bigint" && allowance === 0n;

  const [state, setState] = useState<CycleState>({ status: "idle" });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the user kicked off the current cycle in this session.
  // Stale "done" / "error" from a previous session shouldn't pop a modal.
  const [userTriggered, setUserTriggered] = useState(false);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const pollOnce = async () => {
    try {
      const res = await fetch("/api/demo-cycle", { cache: "no-store" });
      const body = (await res.json()) as CycleState;
      log.info(`poll → ${body.status}`);
      setState(body);
      if (body.status === "running") {
        pollTimer.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
      } else {
        pollTimer.current = null;
        if (body.status === "done") {
          log.ok(
            `cycle done tx=${body.result.upgradeTxHash} impl=${body.result.v2ImplAddress}`,
          );
          void allowanceQuery.refetch();
        }
      }
    } catch (err) {
      log.error("poll failed", err);
      setState({
        status: "error",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        message: err instanceof Error ? err.message : "poll failed",
      });
      pollTimer.current = null;
    }
  };

  useEffect(() => {
    void pollOnce();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-reset stale persisted state from a previous session: if the user
  // didn't trigger this run in the current tab and the chain confirms there's
  // no active approval, drop the cached done/error state.
  if (
    !userTriggered &&
    (state.status === "done" || state.status === "error") &&
    allowanceConfirmedZero
  ) {
    setState({ status: "idle" });
  }

  const onClick = async () => {
    log.start("re-arm clicked");
    setUserTriggered(true);
    stopPolling();
    setState({ status: "running", startedAt: new Date().toISOString() });
    try {
      const res = await fetch("/api/demo-cycle", {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json()) as CycleState;
      log.info(`POST /api/demo-cycle → ${res.status} ${body.status}`);
      setState(body);
      if (body.status === "running") {
        pollTimer.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
      }
    } catch (err) {
      log.error("POST /api/demo-cycle failed", err);
      setState({
        status: "error",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        message: err instanceof Error ? err.message : "request failed",
      });
    }
  };

  const dismissModal = () => {
    log.info("result modal dismissed");
    setState({ status: "idle" });
  };

  const showModal = state.status === "done" && userTriggered;
  const isRunning = state.status === "running";
  const isDone = state.status === "done";
  const isError = state.status === "error";

  return (
    <>
      {showModal && state.status === "done" && (
        <ResultModal result={state.result} onClose={dismissModal} />
      )}

      {!hasThreat && (
        <div
          className="brand-border mb-5 rounded-lg border bg-white/70 p-5 shadow-sm"
          data-testid="demo-controls-card"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-brand-soft">
                demo controls
              </div>
              <h3 className="mt-1 text-base font-bold text-brand">Re-arm the live attack scenario</h3>
              <p className="mt-1 text-xs text-brand-soft">
                For demo purposes — clicking this triggers a fresh proxy upgrade on
                Base mainnet and re-approves the demo spender so Vigil can detect it
                in real time. Takes ~60–90s.
              </p>
            </div>

            <div className="shrink-0">
              {isRunning ? (
                <button
                  disabled
                  className="btn-brand inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm opacity-70"
                >
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Re-arming demo… ~60s
                </button>
              ) : isDone ? (
                <button
                  disabled
                  className="btn-brand inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm opacity-60"
                >
                  Demo armed ✓
                </button>
              ) : (
                <button
                  onClick={onClick}
                  className="btn-brand rounded-md px-4 py-2 text-sm"
                >
                  {isError ? "Try again" : "Re-arm demo"}
                </button>
              )}
            </div>
          </div>

          {isError && state.status === "error" && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50/70 p-3 text-xs text-red-800">
              <div className="font-bold">Cycle failed</div>
              <div className="mt-1 break-words font-mono text-[11px]">{state.message}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ResultModal({
  result,
  onClose,
}: {
  result: CycleResult;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Demo cycle result"
      onClick={onClose}
    >
      <div
        className="brand-border w-full max-w-lg rounded-lg border-2 bg-[var(--brand-cream)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
              cycle complete
            </div>
            <h3 className="mt-1 text-lg font-bold text-brand">Demo armed ✓</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-3xl leading-none text-brand-soft transition-colors hover:text-brand"
          >
            ×
          </button>
        </div>

        <p className="mt-3 text-sm text-brand-soft">
          A fresh proxy upgrade has landed on Base mainnet and the demo spender has
          been re-approved. Vigil&apos;s watcher should pick it up within seconds.
        </p>

        <dl className="mt-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-4 font-mono text-xs">
          <dt className="text-emerald-700/80">upgrade tx</dt>
          <dd className="truncate">
            <a
              href={explorerTxUrl(result.chainId, result.upgradeTxHash)}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-900 underline hover:text-emerald-700"
            >
              {shortenAddress(result.upgradeTxHash)} ↗
            </a>
          </dd>
          <dt className="text-emerald-700/80">new impl</dt>
          <dd className="truncate">
            <a
              href={explorerAddressUrl(result.chainId, result.v2ImplAddress)}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-900 underline hover:text-emerald-700"
            >
              {shortenAddress(result.v2ImplAddress)} ↗
            </a>
          </dd>
          <dt className="text-emerald-700/80">proxy</dt>
          <dd className="truncate">
            <a
              href={explorerAddressUrl(result.chainId, result.proxyAddress)}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-900 underline hover:text-emerald-700"
            >
              {shortenAddress(result.proxyAddress)} ↗
            </a>
          </dd>
          <dt className="text-emerald-700/80">allowance</dt>
          <dd className="text-emerald-900">Unlimited (MaxUint256)</dd>
        </dl>

        <button
          onClick={onClose}
          className="btn-brand mt-6 w-full rounded-md py-2 text-sm font-semibold"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
