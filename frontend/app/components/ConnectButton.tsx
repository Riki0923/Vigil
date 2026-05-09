"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { DEMO_WALLET } from "@/lib/wallet";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="brand-border bg-white/60 hover:bg-white/80 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono text-brand transition-colors"
        title="Disconnect"
      >
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--severity-low)]" />
        {truncate(address)}
      </button>
    );
  }

  if (DEMO_WALLET) {
    return (
      <button
        onClick={() => connect({ connector: injected() })}
        disabled={isPending}
        className="brand-border bg-white/60 hover:bg-white/80 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono text-brand transition-colors"
        title="Click to connect a real wallet for signing"
      >
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--severity-medium)]" />
        {truncate(DEMO_WALLET)}
        <span className="text-brand-soft uppercase tracking-wider text-[10px]">demo</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: injected() })}
      disabled={isPending}
      className="btn-brand inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
