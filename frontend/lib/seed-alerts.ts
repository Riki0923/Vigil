import type { Alert } from "./types";

// Synthetic Sepolia alert used as a fallback so the demo flow works on a
// fresh clone without relying on the gitignored data/alerts-base-sepolia.json.
// Replace the proxy/impl/tx fields when the demo proxy is redeployed.
export const seedAlertsBaseSepolia: Alert[] = [
  {
    id: "demo-sepolia-seed-1",
    timestamp: "2026-05-09T11:10:00.000Z",
    severity: "HIGH",
    proxyAddress: "0x65953e7c7C8A0Ee61be3b33BD88E2961439B21AD",
    implementationAddress: "0x91F276F98a20d3fBC27e3d8ccE73Ad0e78C6358f",
    txHash: "0x42e11f0ac674a86da6bbf3914e825580e8ed91d65f18945db7fe495b989e2f97",
    chainId: 84532,
    isVerified: true,
    hasStorageLayout: true,
    message: "DemoToken proxy upgraded — V1 active (demo seed alert)",
    rawData: {
      storageDiff: null,
      abiDiff: null,
      functionRiskFlags: [],
      matchType: "exact_match",
      contractMeta: {
        matchType: "exact_match",
        creationTxHash: null,
        compilerVersion: "0.8.24+commit.e11b9ed9",
      },
      natSpec: null,
    },
  },
];

export const seedAlertsBaseSepoliaUpdatedAt = "2026-05-09T11:10:00.000Z";
