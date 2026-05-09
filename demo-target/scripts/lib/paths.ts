// Shared network-aware path resolution for demo-target scripts.
// Single source of truth for which network maps to which deployment/alerts file.

import * as path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const SUPPORTED = {
  baseSepolia: { slug: "base-sepolia", chainId: 84532, explorer: "https://sepolia.basescan.org" },
  baseMainnet: { slug: "base-mainnet", chainId: 8453, explorer: "https://basescan.org" },
} as const;

export type SupportedNetwork = keyof typeof SUPPORTED;

export type NetworkPaths = {
  name: SupportedNetwork;
  slug: string;
  chainId: number;
  deploymentsPath: string;
  alertsPath: string;
  explorerBase: string;
};

const ROOT = path.join(__dirname, "..", "..");
const REPO_ROOT = path.join(ROOT, "..");

function isSupported(name: string): name is SupportedNetwork {
  return name in SUPPORTED;
}

export function getNetworkPaths(hre: HardhatRuntimeEnvironment): NetworkPaths {
  const name = hre.network.name;
  if (!isSupported(name)) {
    throw new Error(
      `Unsupported hardhat network "${name}". Use --network baseSepolia or --network baseMainnet.`,
    );
  }
  const cfg = SUPPORTED[name];
  if (hre.network.config.chainId !== cfg.chainId) {
    throw new Error(
      `chainId mismatch for ${name}: hardhat config says ${hre.network.config.chainId}, expected ${cfg.chainId}`,
    );
  }
  return {
    name,
    slug: cfg.slug,
    chainId: cfg.chainId,
    deploymentsPath: path.join(ROOT, "deployments", `${cfg.slug}.json`),
    alertsPath: path.join(REPO_ROOT, "data", `alerts-${cfg.slug}.json`),
    explorerBase: cfg.explorer,
  };
}

// CLI variant for scripts that don't run inside hardhat (e.g. reset.ts via ts-node).
export function getNetworkPathsFromCli(): NetworkPaths {
  const flag = process.argv.find((a) => a.startsWith("--network="));
  const value = flag ? flag.slice("--network=".length) : "baseSepolia";
  if (!isSupported(value)) {
    throw new Error(
      `Unsupported --network "${value}". Use --network=baseSepolia or --network=baseMainnet.`,
    );
  }
  const cfg = SUPPORTED[value];
  return {
    name: value,
    slug: cfg.slug,
    chainId: cfg.chainId,
    deploymentsPath: path.join(ROOT, "deployments", `${cfg.slug}.json`),
    alertsPath: path.join(REPO_ROOT, "data", `alerts-${cfg.slug}.json`),
    explorerBase: cfg.explorer,
  };
}
