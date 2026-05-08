import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { startUpgradeWatcher } from "../watchers/upgradeWatcher.js";
import { isVerified, getStorageLayout, BASE_SEPOLIA_CHAIN_ID } from "../sourcify/index.js";
import { diffStorageLayouts, assessRisk } from "../sourcify/diffStorage.js";
import { createAlert, logAlert, AlertSeverity } from "../alerts/index.js";
import { analyseUpgrade } from "./analyser.js";

dotenv.config();

const RPC_URL = process.env.RPC_URL!;

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

  // Step 1 — verification check
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

  // Step 2 — storage layout fetch
  console.log(`\n[Pipeline] Step 2/4 — Fetching storage layouts...`);
  const [oldLayout, newLayout] = await Promise.all([
    getStorageLayout(oldImplAddress, BASE_SEPOLIA_CHAIN_ID),
    getStorageLayout(newImplAddress, BASE_SEPOLIA_CHAIN_ID),
  ]);

  const hasStorageLayout = !!oldLayout && !!newLayout;
  console.log(`  Old impl layout: ${oldLayout ? `found (${oldLayout.storage.length} slot(s))` : "not found"}`);
  console.log(`  New impl layout: ${newLayout ? `found (${newLayout.storage.length} slot(s))` : "not found"}`);

  // Step 3 — diff + risk assessment
  console.log(`\n[Pipeline] Step 3/4 — Diff + risk assessment...`);

  if (!hasStorageLayout) {
    const missing = [!oldLayout && "old", !newLayout && "new"].filter(Boolean).join(" and ");
    console.log(`[Pipeline] Layout missing for ${missing} impl — defaulting to MEDIUM severity`);
    logAlert(createAlert({
      severity: AlertSeverity.MEDIUM,
      proxyAddress,
      implementationAddress: newImplAddress,
      txHash,
      isVerified: true,
      hasStorageLayout: false,
      message: `Verified upgrade — storage layout unavailable for ${missing} implementation`,
      rawData: { oldImplAddress, oldLayoutFound: !!oldLayout, newLayoutFound: !!newLayout },
    }));
    return;
  }

  const diff = diffStorageLayouts(oldLayout, newLayout);
  const severity = assessRisk(diff);

  console.log(`[Pipeline] Risk assessed: ${severity}`);

  console.log(`\n[Pipeline] Step 4/4 — AI analysis...`);
  const analysis = await analyseUpgrade({
    proxyAddress,
    oldImplementation: oldImplAddress,
    newImplementation: newImplAddress,
    diff,
    severity,
  });

  logAlert(createAlert({
    severity,
    proxyAddress,
    implementationAddress: newImplAddress,
    txHash,
    isVerified: true,
    hasStorageLayout: true,
    message: `Storage layout diff: ${diff.movedVariables.length} moved, ${diff.removedVariables.length} removed, ${diff.addedVariables.length} added`,
    rawData: diff,
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
