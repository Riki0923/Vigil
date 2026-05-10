import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

type Address = `0x${string}`;

export const SUPPORTED_CHAINS = {
  base: {
    id: base.id,
    name: "Base",
    short: "base",
    explorerTxBase: "https://basescan.org/tx/",
    explorerAddressBase: "https://basescan.org/address/",
  },
  baseSepolia: {
    id: baseSepolia.id,
    name: "Base Sepolia",
    short: "base-sepolia",
    explorerTxBase: "https://sepolia.basescan.org/tx/",
    explorerAddressBase: "https://sepolia.basescan.org/address/",
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

// Demo proxies per chain. Mainnet is intentionally unset, contracts are Sepolia-only.
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

export function explorerAddressUrl(chainId: number, address: string): string {
  if (chainId === base.id) return `${SUPPORTED_CHAINS.base.explorerAddressBase}${address}`;
  return `${SUPPORTED_CHAINS.baseSepolia.explorerAddressBase}${address}`;
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const MAX_UINT256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

export type FormattedAllowance = {
  isUnlimited: boolean;
  label: string;
  detail: string;
};

export function formatAllowance(
  allowance: bigint,
  decimals = 18,
  tokenName = "Vigil Tokens",
): FormattedAllowance {
  if (allowance === MAX_UINT256) {
    return {
      isUnlimited: true,
      label: `Unlimited ${tokenName}`,
      detail: "MaxUint256. The spender can drain your entire balance.",
    };
  }
  const whole = allowance / 10n ** BigInt(decimals);
  return {
    isUnlimited: false,
    label: `${whole.toLocaleString()} ${tokenName}`,
    detail: `${allowance.toString()} (raw). The spender can take up to this amount.`,
  };
}

// First-visit landing chain. Sepolia/testnet is hidden from the UI for now , 
// only Base mainnet is selectable, so this is also the only valid view chain.
export const DEFAULT_VIEW_CHAIN_ID: SupportedChainId = base.id;
