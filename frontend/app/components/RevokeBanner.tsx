"use client";

import { useState } from "react";
import { erc20Abi, createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
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

const DEMO_WALLET_PRIVATE_KEY = process.env.NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY as
  | Address
  | undefined;

function chainForId(id: number) {
  if (id === base.id) return base;
  if (id === baseSepolia.id) return baseSepolia;
  return null;
}

export function RevokeBanner({
  proxyAddress,
  alertChainId,
}: {
  proxyAddress: string;
  alertChainId: number | undefined;
}) {
  const { viewChainId } = useViewChain();

  const targetChainId = alertChainId ?? SUPPORTED_CHAINS.base.id;
  const demoProxy = demoProxyForChain(targetChainId);

  const isDemoProxy =
    Boolean(demoProxy) && demoProxy!.toLowerCase() === proxyAddress.toLowerCase();
  const matchesViewChain = targetChainId === viewChainId;

  const allowanceQuery = useDemoAllowance(
    targetChainId,
    isDemoProxy && matchesViewChain ? (demoProxy as Address) : undefined,
    DEMO_WALLET as Address | undefined,
    DEMO_SPENDER,
  );

  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [isMining, setIsMining] = useState(false);
  const [isMined, setIsMined] = useState(false);
  const [orchestrationError, setOrchestrationError] = useState<string | null>(null);

  if (!isDemoProxy || !matchesViewChain) return null;

  const allowance = allowanceQuery.data;
  const wasRevoked = isMined;
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
    console.log("[RevokeBanner] click revoke", {
      targetChainId,
      proxy: demoProxy,
      spender: DEMO_SPENDER,
      hasKey: Boolean(DEMO_WALLET_PRIVATE_KEY),
      currentAllowance: allowance?.toString(),
    });
    if (!DEMO_WALLET_PRIVATE_KEY) {
      console.error("[RevokeBanner] missing NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY env var");
      setOrchestrationError("NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY not set");
      return;
    }
    const chain = chainForId(targetChainId);
    if (!chain) {
      console.error(`[RevokeBanner] unsupported chain id ${targetChainId}`);
      setOrchestrationError(`Unsupported chain: ${targetChainId}`);
      return;
    }
    setOrchestrationError(null);
    setTxHash(undefined);
    setIsMined(false);
    setIsSending(true);
    try {
      const account = privateKeyToAccount(DEMO_WALLET_PRIVATE_KEY);
      console.log(`[RevokeBanner] signing as ${account.address} on ${chain.name}`);
      const walletClient = createWalletClient({ account, chain, transport: http() });
      const publicClient = createPublicClient({ chain, transport: http() });
      const hash = await walletClient.writeContract({
        address: demoProxy as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [DEMO_SPENDER as Address, 0n],
      });
      console.log(`[RevokeBanner] tx submitted: ${hash}`);
      setTxHash(hash);
      setIsSending(false);
      setIsMining(true);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(
        `[RevokeBanner] tx mined block=${receipt.blockNumber} status=${receipt.status}`,
      );
      setIsMining(false);
      setIsMined(true);
      void allowanceQuery.refetch();
    } catch (err) {
      console.error("[RevokeBanner] revoke failed:", err);
      const msg = err instanceof Error ? err.message : "revoke failed";
      setOrchestrationError(msg);
      setIsSending(false);
      setIsMining(false);
    }
  };

  const buttonLabel = isSending
    ? "Sending tx…"
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
          disabled={isSending || isMining}
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
