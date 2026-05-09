"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_VIEW_CHAIN_ID, type SupportedChainId } from "@/lib/wallet";

const STORAGE_KEY = "vigil:view-chain";

type ViewChainContextValue = {
  viewChainId: SupportedChainId;
  setViewChainId: (id: SupportedChainId) => void;
};

const ViewChainContext = createContext<ViewChainContextValue | null>(null);

// Testnet is hidden from the UI, so only the default chain is a valid stored
// view choice. Stale localStorage values (e.g. a user who previously picked
// Base Sepolia) are ignored and fall back to DEFAULT_VIEW_CHAIN_ID.
const VALID_IDS = new Set<number>([DEFAULT_VIEW_CHAIN_ID]);

export function ViewChainProvider({ children }: { children: ReactNode }) {
  const [viewChainId, setViewChainIdState] = useState<SupportedChainId>(DEFAULT_VIEW_CHAIN_ID);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const n = stored ? Number(stored) : NaN;
    if (Number.isFinite(n) && VALID_IDS.has(n)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration read from localStorage
      setViewChainIdState(n as SupportedChainId);
    }
  }, []);

  const setViewChainId = (id: SupportedChainId) => {
    setViewChainIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(id));
    }
  };

  return (
    <ViewChainContext.Provider value={{ viewChainId, setViewChainId }}>
      {children}
    </ViewChainContext.Provider>
  );
}

export function useViewChain(): ViewChainContextValue {
  const ctx = useContext(ViewChainContext);
  if (!ctx) throw new Error("useViewChain must be used within ViewChainProvider");
  return ctx;
}
