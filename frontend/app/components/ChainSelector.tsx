"use client";

import { SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/wallet";
import { useViewChain } from "./ViewChainContext";

// Sepolia option is hidden for now, UI is mainnet-only. Re-add the
// Base Sepolia entry here when we want to expose testnet again.
const OPTIONS: { id: SupportedChainId; label: string; sublabel: string }[] = [
  { id: SUPPORTED_CHAINS.base.id, label: "Base", sublabel: "mainnet" },
];

export function ChainSelector() {
  const { viewChainId, setViewChainId } = useViewChain();

  return (
    <div
      role="tablist"
      aria-label="Select chain to view"
      className="brand-border inline-flex items-center gap-0.5 rounded-full border bg-white/60 p-0.5 text-xs"
    >
      {OPTIONS.map((opt) => {
        const active = opt.id === viewChainId;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => setViewChainId(opt.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
              active
                ? "bg-[var(--brand-navy)] text-white"
                : "text-brand hover:bg-white/80"
            }`}
          >
            <span className="font-semibold">{opt.label}</span>
            <span className={active ? "opacity-70" : "text-brand-soft"}>{opt.sublabel}</span>
          </button>
        );
      })}
    </div>
  );
}
