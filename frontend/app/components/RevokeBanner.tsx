"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { erc20Abi } from "viem";
import { injected } from "wagmi/connectors";
import { hasActiveApproval, useDemoAllowance } from "@/lib/approvals";
import {
  DEMO_SPENDER,
  DEMO_WALLET,
  demoProxyForChain,
  explorerTxUrl,
  SUPPORTED_CHAINS,
} from "@/lib/wallet";
import { useViewChain } from "./ViewChainContext";

type Address = `0x${string}`;

export function RevokeBanner({
  proxyAddress,
  alertChainId,
}: {
  proxyAddress: string;
  alertChainId: number | undefined;
}) {
  const { address: realAddress, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { connectAsync } = useConnect();
  const { viewChainId } = useViewChain();

  const targetChainId = alertChainId ?? SUPPORTED_CHAINS.base.id;
  const demoProxy = demoProxyForChain(targetChainId);

  const isDemoProxy =
    Boolean(demoProxy) && demoProxy!.toLowerCase() === proxyAddress.toLowerCase();
  const matchesViewChain = targetChainId === viewChainId;

  // Use real connected address if present; otherwise read on behalf of the demo wallet.
  const ownerForRead =
    (realAddress as Address | undefined) ?? (DEMO_WALLET as Address | undefined);

  const allowanceQuery = useDemoAllowance(
    targetChainId,
    isDemoProxy && matchesViewChain ? (demoProxy as Address) : undefined,
    ownerForRead,
    DEMO_SPENDER,
  );

  const {
    writeContractAsync,
    data: txHash,
    isPending: isWritePending,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: targetChainId,
  });
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [orchestrationError, setOrchestrationError] = useState<string | null>(null);

  if (!isDemoProxy || !matchesViewChain) return null;

  const allowance = allowanceQuery.data;
  const wasRevoked = isMined && (allowance ?? 0n) === 0n;
  if (!hasActiveApproval(allowance) && !wasRevoked) return null;

  if (wasRevoked) {
    return (
      <div className="brand-border mt-3 rounded-md border bg-emerald-50 px-3 py-2 text-xs">
        <div className="font-semibold text-emerald-700">Approval revoked.</div>
        <div className="text-emerald-700/80">Allowance is now 0 on this contract.</div>
      </div>
    );
  }

  const handleRevoke = async () => {
    resetWrite();
    setOrchestrationError(null);
    setIsOrchestrating(true);
    try {
      if (!isConnected) {
        await connectAsync({ connector: injected(), chainId: targetChainId });
      } else if (walletChainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }
      await writeContractAsync({
        chainId: targetChainId,
        address: demoProxy as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [DEMO_SPENDER as Address, 0n],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "revoke failed";
      setOrchestrationError(msg);
    } finally {
      setIsOrchestrating(false);
    }
  };

  const buttonLabel = isOrchestrating
    ? !isConnected
      ? "Connecting wallet…"
      : walletChainId !== targetChainId
        ? "Switching chain…"
        : "Confirm in wallet…"
    : isWritePending
      ? "Confirm in wallet…"
      : isMining
        ? "Mining…"
        : "Revoke approval";

  return (
    <div className="brand-border mt-3 rounded-md border bg-rose-50 px-3 py-2 text-xs">
      <div className="font-semibold text-rose-700">Your wallet is exposed.</div>
      <div className="mt-1 text-rose-700/80">
        You have an active approval on this contract. Revoke it before the new implementation
        can move your tokens.
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          disabled={isOrchestrating || isWritePending || isMining}
          onClick={handleRevoke}
          className="btn-brand inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs disabled:opacity-60"
        >
          {buttonLabel}
        </button>
        {txHash && (
          <a
            href={explorerTxUrl(targetChainId, txHash)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-rose-700/70 underline"
          >
            view tx
          </a>
        )}
        {orchestrationError && (
          <span className="text-[10px] text-rose-700/70" title={orchestrationError}>
            failed — see console
          </span>
        )}
      </div>
    </div>
  );
}
