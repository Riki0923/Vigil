import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { startUpgradeWatcher } from "../watchers/upgradeWatcher.js";
import { isVerified, getStorageLayout, getABI, getContractMeta, BASE_SEPOLIA_CHAIN_ID } from "../sourcify/index.js";
import { diffStorageLayouts, assessRisk } from "../sourcify/diffStorage.js";
import { diffABIs, assessFunctionRisk, type ABIItem } from "../sourcify/diffFunctions.js";
import { createAlert, logAlert, AlertSeverity } from "../alerts/index.js";
import { analyseUpgrade } from "./analyser.js";

dotenv.config();

const RPC_URL = process.env.RPC_URL!;

const SEVERITY_ORDER: AlertSeverity[] = [
  AlertSeverity.LOW,
  AlertSeverity.MEDIUM,
  AlertSeverity.HIGH,
  AlertSeverity.CRITICAL,
];

function maxSeverity(...severities: AlertSeverity[]): AlertSeverity {
  return severities.reduce((a, b) =>
    SEVERITY_ORDER.indexOf(b) > SEVERITY_ORDER.indexOf(a) ? b : a
  );
}

function bumpSeverity(severity: AlertSeverity): AlertSeverity {
  const idx = SEVERITY_ORDER.indexOf(severity);
  return SEVERITY_ORDER[Math.min(idx + 1, SEVERITY_ORDER.length - 1)] ?? AlertSeverity.CRITICAL;
}

export async function processUpgrade(
  txHash: string,
  proxyAddress: string,
  newImplAddress: string,
  oldImplAddress: string
): Promise<void> {
  console.log(`\n[Pipeline] ── Upgrade detected ───────────────────────`);
  console.log(`  Tx:       ${txHash}`);
  console.log(`  Proxy:    ${proxyAddress}`);
  console.log(`  Old impl: ${oldImplAddress}`);
  console.log(`  New impl: ${newImplAddress}`);

  // Step 1 — verification
  console.log(`\n[Pipeline] Step 1/4 — Checking Sourcify verification...`);
  const verified = await isVerified(newImplAddress, BASE_SEPOLIA_CHAIN_ID);

  if (!verified) {
    console.log(`[Pipeline] Not verified — emitting CRITICAL alert and stopping`);
    logAlert(createAlert({
      severity: AlertSeverity.CRITICAL,
      proxyAddress,
      implementationAddress: newImplAddress,
      txHash,
      isVerified: false,
      hasStorageLayout: false,
      message: `Unverified implementation detected`,
      rawData: { oldImplAddress },
    }));
    return;
  }

  console.log(`[Pipeline] Verified — continuing analysis`);

  // Step 2 — fetch all data in parallel
  console.log(`\n[Pipeline] Step 2/4 — Fetching layouts, ABIs, and contract meta...`);
  const [oldLayout, newLayout, oldABI, newABI, contractMeta] = await Promise.all([
    getStorageLayout(oldImplAddress, BASE_SEPOLIA_CHAIN_ID),
    getStorageLayout(newImplAddress, BASE_SEPOLIA_CHAIN_ID),
    getABI(oldImplAddress, BASE_SEPOLIA_CHAIN_ID),
    getABI(newImplAddress, BASE_SEPOLIA_CHAIN_ID),
    getContractMeta(newImplAddress, BASE_SEPOLIA_CHAIN_ID),
  ]);

  const hasStorageLayout = !!oldLayout && !!newLayout;
  const hasABI = !!oldABI && !!newABI;
  const matchType = contractMeta?.matchType ?? null;

  console.log(`  Storage layout: ${hasStorageLayout ? "both found" : "incomplete"}`);
  console.log(`  ABI:            ${hasABI ? "both found" : "incomplete"}`);
  console.log(`  Match type:     ${matchType ?? "unknown"}`);
  console.log(`  Compiler:       ${contractMeta?.compilerVersion ?? "unknown"}`);
  console.log(`  Creation tx:    ${contractMeta?.creationTxHash ?? "unknown"}`);

  // Step 3 — diffs + risk assessment
  console.log(`\n[Pipeline] Step 3/4 — Running diffs and assessing risk...`);

  const storageDiff = hasStorageLayout
    ? diffStorageLayouts(oldLayout!, newLayout!)
    : null;

  const abiDiff = hasABI
    ? diffABIs(oldABI! as ABIItem[], newABI! as ABIItem[])
    : null;

  const storageSeverity = storageDiff ? assessRisk(storageDiff) : AlertSeverity.MEDIUM;
  const functionRiskFlags = abiDiff ? assessFunctionRisk(abiDiff) : [];

  const functionSeverity = functionRiskFlags.reduce<AlertSeverity>((acc, flag) => {
    return maxSeverity(acc, flag.level as AlertSeverity);
  }, AlertSeverity.LOW);

  let severity = maxSeverity(storageSeverity, functionSeverity);

  if (matchType === "partial") {
    const bumped = bumpSeverity(severity);
    console.log(`[Pipeline] Partial match — bumping severity ${severity} → ${bumped}`);
    severity = bumped;
  }

  console.log(`[Pipeline] Final severity: ${severity}`);

  if (functionRiskFlags.length > 0) {
    console.log(`[Pipeline] Function risk flags:`);
    for (const flag of functionRiskFlags) {
      console.log(`  [${flag.level}] ${flag.message}`);
    }
  }

  // Step 4 — AI analysis
  console.log(`\n[Pipeline] Step 4/4 — AI analysis...`);
  const analysis = await analyseUpgrade({
    proxyAddress,
    oldImplementation: oldImplAddress,
    newImplementation: newImplAddress,
    storageDiff: storageDiff ?? "unavailable",
    abiDiff: abiDiff ?? "unavailable",
    functionRiskFlags,
    severity,
  });

  logAlert(createAlert({
    severity,
    proxyAddress,
    implementationAddress: newImplAddress,
    txHash,
    isVerified: true,
    hasStorageLayout,
    message: [
      storageDiff
        ? `Storage: ${storageDiff.movedVariables.length} moved, ${storageDiff.removedVariables.length} removed, ${storageDiff.addedVariables.length} added`
        : "Storage layout unavailable",
      abiDiff
        ? `ABI: ${abiDiff.addedFunctions.length} added, ${abiDiff.removedFunctions.length} removed, ${abiDiff.modifiedFunctions.length} modified`
        : "ABI unavailable",
      matchType ? `Match: ${matchType}` : null,
    ].filter(Boolean).join(" | "),
    rawData: { storageDiff, abiDiff, functionRiskFlags, matchType, contractMeta },
    analysis,
  }));
}

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();

  console.log(`[Vigil] Connected to network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`[Vigil] Current block: ${blockNumber}`);

  await startUpgradeWatcher(provider, processUpgrade);
}

main().catch((err) => {
  console.error("[Vigil] Fatal startup error:", err);
  process.exit(1);
});
