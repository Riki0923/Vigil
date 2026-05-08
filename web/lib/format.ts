import type { AlertSeverity } from "./types";

export const BASE_SEPOLIA_CHAIN_ID = 84532;

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function truncateHash(hash: string): string {
  return truncateAddress(hash, 6);
}

export function relativeTime(isoTimestamp: string): string {
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function severityClasses(s: AlertSeverity): string {
  switch (s) {
    case "LOW":
      return "bg-zinc-800 text-zinc-300 border-zinc-700";
    case "MEDIUM":
      return "bg-amber-950 text-amber-300 border-amber-800";
    case "HIGH":
      return "bg-orange-950 text-orange-300 border-orange-700";
    case "CRITICAL":
      return "bg-red-950 text-red-300 border-red-700";
  }
}

export function severityRank(s: AlertSeverity): number {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[s];
}

export function basescanTxUrl(txHash: string, chainId = BASE_SEPOLIA_CHAIN_ID): string {
  const base =
    chainId === BASE_SEPOLIA_CHAIN_ID
      ? "https://sepolia.basescan.org"
      : "https://basescan.org";
  return `${base}/tx/${txHash}`;
}

export function basescanAddressUrl(address: string, chainId = BASE_SEPOLIA_CHAIN_ID): string {
  const base =
    chainId === BASE_SEPOLIA_CHAIN_ID
      ? "https://sepolia.basescan.org"
      : "https://basescan.org";
  return `${base}/address/${address}`;
}
