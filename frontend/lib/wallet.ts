import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

type Address = `0x${string}`;

export const SUPPORTED_CHAINS = {
  base: { id: base.id, name: "Base", short: "base", explorerTxBase: "https://basescan.org/tx/" },
  baseSepolia: {
    id: baseSepolia.id,
    name: "Base Sepolia",
    short: "base-sepolia",
    explorerTxBase: "https://sepolia.basescan.org/tx/",
  },
} as const;

export type SupportedChainId = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]["id"];

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [injected()],
  transports: {
    [base.id]: http("https://mainnet.base.org"),
    [baseSepolia.id]: http("https://sepolia.base.org"),
  },
  ssr: true,
});

// Demo proxies per chain. Mainnet is intentionally unset — contracts are Sepolia-only.
const DEMO_PROXY_BASE = process.env.NEXT_PUBLIC_DEMO_PROXY_BASE as Address | undefined;
const DEMO_PROXY_BASE_SEPOLIA = process.env.NEXT_PUBLIC_DEMO_PROXY_BASE_SEPOLIA as
  | Address
  | undefined;

export const DEMO_SPENDER = process.env.NEXT_PUBLIC_DEMO_SPENDER as Address | undefined;
export const DEMO_WALLET = process.env.NEXT_PUBLIC_DEMO_WALLET as Address | undefined;

export function demoProxyForChain(chainId: number): Address | undefined {
  if (chainId === base.id) return DEMO_PROXY_BASE;
  if (chainId === baseSepolia.id) return DEMO_PROXY_BASE_SEPOLIA;
  return undefined;
}

export function explorerTxUrl(chainId: number, txHash: string): string {
  if (chainId === base.id) return `${SUPPORTED_CHAINS.base.explorerTxBase}${txHash}`;
  return `${SUPPORTED_CHAINS.baseSepolia.explorerTxBase}${txHash}`;
}

// First-visit landing chain. Persisted choice in localStorage takes precedence
// after the user picks. Sepolia is where the demo proxy + ENS subname records
// live, so judges and first-time visitors land on the screen with the live alert
// + reputation panel without having to click the chain switch.
export const DEFAULT_VIEW_CHAIN_ID: SupportedChainId = baseSepolia.id;
