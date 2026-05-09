// ENS provider and contract addresses for Ethereum Sepolia and Ethereum mainnet.
// Sepolia hosts vigil.eth (testnet); mainnet hosts vigilbot.eth (production parent).
// The agent watches Base separately — see src/agent/index.ts.

import { ethers } from "ethers";

// Sepolia ENS deployments. Source: https://docs.ens.domains/learn/deployments
export const ENS_SEPOLIA = {
  registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  publicResolver: "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD",
  nameWrapper: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
  ethRegistrarController: "0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72",
  chainId: 11155111,
} as const;

// Ethereum mainnet ENS deployments. Source: https://docs.ens.domains/learn/deployments
// ETHRegistrarController address verified live: an alternate deployment
// (0x59E16f…) reverts on makeCommitment, so we pin the canonical controller.
export const ENS_MAINNET = {
  registry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  publicResolver: "0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63",
  nameWrapper: "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401",
  ethRegistrarController: "0x253553366Da8546fC250F225fe3d25d0C782303b",
  chainId: 1,
} as const;

export type EnsNetwork = "sepolia" | "mainnet";
export type EnsContracts = typeof ENS_SEPOLIA | typeof ENS_MAINNET;

// ENSIP-11 multichain coin type for an EVM chain.
export function evmCoinType(chainId: number): bigint {
  return BigInt(chainId) | 0x80000000n;
}

export const COIN_TYPE = {
  ethereum: 60n,
  baseMainnet: evmCoinType(8453),
  baseSepolia: evmCoinType(84532),
} as const;

let cachedSepoliaProvider: ethers.JsonRpcProvider | null = null;
let cachedMainnetProvider: ethers.JsonRpcProvider | null = null;

export function getSepoliaProvider(): ethers.JsonRpcProvider {
  if (cachedSepoliaProvider) return cachedSepoliaProvider;
  const url = process.env.SEPOLIA_RPC_URL;
  if (!url) {
    throw new Error(
      "SEPOLIA_RPC_URL is not set — required for ENS resolution on Ethereum Sepolia",
    );
  }
  cachedSepoliaProvider = new ethers.JsonRpcProvider(url, ENS_SEPOLIA.chainId);
  return cachedSepoliaProvider;
}

export function hasSepoliaProvider(): boolean {
  return Boolean(process.env.SEPOLIA_RPC_URL);
}

export function getSepoliaSigner(): ethers.Wallet {
  const pk = process.env.ENS_REGISTRAR_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "ENS_REGISTRAR_PRIVATE_KEY is not set — required for ENS write operations (subname creation, record updates)",
    );
  }
  return new ethers.Wallet(pk, getSepoliaProvider());
}

export function getMainnetProvider(): ethers.JsonRpcProvider {
  if (cachedMainnetProvider) return cachedMainnetProvider;
  const url = process.env.MAINNET_RPC_URL;
  if (!url) {
    throw new Error(
      "MAINNET_RPC_URL is not set — required for ENS resolution on Ethereum mainnet",
    );
  }
  cachedMainnetProvider = new ethers.JsonRpcProvider(url, ENS_MAINNET.chainId);
  return cachedMainnetProvider;
}

export function hasMainnetProvider(): boolean {
  return Boolean(process.env.MAINNET_RPC_URL);
}

export function getMainnetSigner(): ethers.Wallet {
  const pk = process.env.ENS_REGISTRAR_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "ENS_REGISTRAR_PRIVATE_KEY is not set — required for ENS write operations (subname creation, record updates)",
    );
  }
  return new ethers.Wallet(pk, getMainnetProvider());
}

// Network-keyed accessors used by scripts that switch between Sepolia and mainnet.
export function getEnsContracts(network: EnsNetwork): EnsContracts {
  return network === "mainnet" ? ENS_MAINNET : ENS_SEPOLIA;
}

export function getEnsProvider(network: EnsNetwork): ethers.JsonRpcProvider {
  return network === "mainnet" ? getMainnetProvider() : getSepoliaProvider();
}

export function getEnsSigner(network: EnsNetwork): ethers.Wallet {
  return network === "mainnet" ? getMainnetSigner() : getSepoliaSigner();
}
