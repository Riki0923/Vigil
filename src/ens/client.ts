// Ethereum Sepolia provider and ENS contract addresses.
// vigil.eth and all subnames live on Sepolia; the agent watches Base Sepolia separately.

import { ethers } from "ethers";

// Sepolia ENS deployments. Source: https://docs.ens.domains/learn/deployments
export const ENS_SEPOLIA = {
  registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  publicResolver: "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD",
  nameWrapper: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
  ethRegistrarController: "0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72",
  chainId: 11155111,
} as const;

// ENSIP-11 multichain coin type for an EVM chain.
export function evmCoinType(chainId: number): bigint {
  return BigInt(chainId) | 0x80000000n;
}

export const COIN_TYPE = {
  ethereum: 60n,
  baseMainnet: evmCoinType(8453),
  baseSepolia: evmCoinType(84532),
} as const;

let cachedProvider: ethers.JsonRpcProvider | null = null;

export function getSepoliaProvider(): ethers.JsonRpcProvider {
  if (cachedProvider) return cachedProvider;
  const url = process.env.SEPOLIA_RPC_URL;
  if (!url) {
    throw new Error(
      "SEPOLIA_RPC_URL is not set — required for ENS resolution on Ethereum Sepolia",
    );
  }
  cachedProvider = new ethers.JsonRpcProvider(url, ENS_SEPOLIA.chainId);
  return cachedProvider;
}

export function hasSepoliaProvider(): boolean {
  return Boolean(process.env.SEPOLIA_RPC_URL);
}

// Convenience: a wallet for write ops, only available when a private key is configured.
export function getSepoliaSigner(): ethers.Wallet {
  const pk = process.env.ENS_REGISTRAR_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "ENS_REGISTRAR_PRIVATE_KEY is not set — required for ENS write operations (subname creation, record updates)",
    );
  }
  return new ethers.Wallet(pk, getSepoliaProvider());
}
