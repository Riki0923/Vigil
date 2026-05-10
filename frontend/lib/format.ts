import type { AlertSeverity } from "./types";

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const DEFAULT_CHAIN_ID = BASE_MAINNET_CHAIN_ID;

export function chainName(chainId: number): string {
  switch (chainId) {
    case BASE_MAINNET_CHAIN_ID:
      return "Base";
    case BASE_SEPOLIA_CHAIN_ID:
      return "Base Sepolia";
    case 1:
      return "Ethereum";
    default:
      return `chain ${chainId}`;
  }
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function truncateHash(hash: string): string {
  return truncateAddress(hash, 6);
}

export function relativeTime(isoTimestamp: string): string {
  const t = Date.parse(isoTimestamp);
  if (Number.isNaN(t)) return ", ";
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
      return "sev-low";
    case "MEDIUM":
      return "sev-medium";
    case "HIGH":
      return "sev-high";
    case "CRITICAL":
      return "sev-critical";
  }
}

export function severityRank(s: AlertSeverity): number {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[s];
}

function basescanRoot(chainId: number): string {
  return chainId === BASE_SEPOLIA_CHAIN_ID
    ? "https://sepolia.basescan.org"
    : "https://basescan.org";
}

export function basescanTxUrl(txHash: string, chainId = DEFAULT_CHAIN_ID): string {
  return `${basescanRoot(chainId)}/tx/${txHash}`;
}

export function basescanAddressUrl(address: string, chainId = DEFAULT_CHAIN_ID): string {
  return `${basescanRoot(chainId)}/address/${address}`;
}
