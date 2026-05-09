import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { startUpgradeWatcher } from "../watchers/upgradeWatcher.js";
import {
  isVerifiedWithRetry,
  findSimilarContracts,
  getStorageLayout,
  getABI,
  getContractMeta,
  getNatSpec,
} from "../sourcify/index.js";
import { diffStorageLayouts, assessRisk } from "../sourcify/diffStorage.js";
import { diffABIs, assessFunctionRisk, type ABIItem } from "../sourcify/diffFunctions.js";
import { createAlert, AlertSeverity } from "../alerts/index.js";
import { emitAlert } from "../delivery/emit.js";
import { analyseUpgrade } from "./analyser.js";
import { initSwarm, publishData } from "../swarm/index.js";
import { sendTelegramAlert } from "../delivery/telegram.js";
import { enrichAlert } from "../apify/index.js";
import {
  hasEnsWriter,
  hasSepoliaProvider,
  loadEnsCache,
  lookupName,
  resolveAgentConfig,
  updateTargetReputation,
} from "../ens/index.js";

dotenv.config();

const RPC_URL = process.env.BASE_MAINNET_RPC_URL!;

// Picks the agent ENS name matching the active VIGIL_ENS_NETWORK so the boot
// reads from agent.vigilbot.eth on mainnet and agent.vigil.eth on sepolia
// without operators having to keep two env vars in sync manually.
function getAgentEnsName(): string {
  const network = process.env.VIGIL_ENS_NETWORK?.toLowerCase();
  if (network === "mainnet") {
    return (
      process.env.VIGIL_AGENT_ENS_NAME_MAINNET ??
      `agent.${process.env.VIGIL_PARENT_ENS_NAME_MAINNET ?? "vigilbot.eth"}`
    );
  }
  return process.env.VIGIL_AGENT_ENS_NAME ?? "agent.vigil.eth";
}

const VIGIL_AGENT_ENS_NAME = getAgentEnsName();

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

// Fire-and-forget reputation write to the target's ENS subname. Logs on
// failure but never blocks the alert flow. Skipped if the proxy isn't named
// in the ENS cache or if no registrar key is configured.
function maybeWriteReputation(
  name: string | null,
  severity: AlertSeverity,
  txHash: string,
  timestamp: string,
): void {
  if (!name) return;
  if (!hasEnsWriter()) return;
  updateTargetReputation(name, { severity, txHash, timestamp }).catch((err) => {
    console.warn(`[Vigil/ENS] Reputation update failed for ${name}:`, err.shortMessage ?? err.message ?? err);
  });
}

export async function processUpgrade(
  txHash: string,
  proxyAddress: string,
  newImplAddress: string,
  oldImplAddress: string,
  provider: ethers.JsonRpcProvider,
  block: ethers.Block,
  proxyName: string | null = null,
  severityFloor: AlertSeverity | null = null,
): Promise<void> {
  // Use the actual chain the agent is watching for Sourcify lookups + alert
  // tagging. Replaces a previously-hardcoded constant that was misnamed
  // BASE_SEPOLIA_CHAIN_ID but contained 8453 (Base mainnet).
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`\n[Pipeline] ── Upgrade detected ───────────────────────`);
  console.log(`  Tx:       ${txHash}`);
  if (proxyName) {
    console.log(`  Name:     ${proxyName}`);
  }
  console.log(`  Proxy:    ${proxyAddress}`);
  console.log(`  Old impl: ${oldImplAddress}`);
  console.log(`  New impl: ${newImplAddress}`);
  console.log(`  Chain:    ${chainId}`);

  if (newImplAddress.toLowerCase() === oldImplAddress.toLowerCase()) {
    console.log(`[Pipeline] Skipping — same implementation address, checksum difference only`);
    return;
  }

  // Step 1 — verification with retry
  console.log(`\n[Pipeline] Step 1/4 — Checking Sourcify verification (up to 3 retries, 30s apart)...`);
  // 2 retries × 15s = 30s ceiling before falling through to the unverified
  // path. Tighter than the previous 3×30s = 90s because for a live booth
  // demo, 90s of "Sourcify retrying..." dead air kills the pacing.
  const verified = await isVerifiedWithRetry(newImplAddress, chainId, 2, 15_000);

  if (!verified) {
    console.log(`[Pipeline] Not verified after retries — checking for similar contracts...`);

    const similarContracts = await findSimilarContracts(newImplAddress, chainId, provider);

    const highSimilarity = similarContracts.filter((c) => c.similarity >= 0.9);
    const hasSimilar = similarContracts.length > 0;

    let message = `Unverified implementation detected`;

    if (highSimilarity.length > 0) {
      message = `HIGH SIMILARITY to known contract — possible clone (${highSimilarity.length} match(es) above 0.9 score)`;
      console.log(`[Pipeline] High similarity matches found:`);
      for (const c of highSimilarity) {
        console.log(`  ${c.address} (chain ${c.chainId}, score ${c.similarity.toFixed(3)})`);
      }
    } else if (hasSimilar) {
      message = `Unverified implementation — similar to ${similarContracts.length} known contract(s) in Sourcify database`;
      console.log(`[Pipeline] Similar contracts found: ${similarContracts.length}`);
    } else {
      console.log(`[Pipeline] No similar contracts found`);
    }

    const unverifiedAnalysis = {
      summary: 'Contract source is not verified on Sourcify — cannot assess safety.',
      explanation: 'Unverified implementations pose a critical risk as their source code cannot be inspected or audited. This upgrade introduced an implementation that has not been publicly verified.',
      recommendation: 'Do not interact with this proxy until the implementation source is verified on Sourcify.',
      confidence: 'high' as const,
    };

    const unverifiedAlert = createAlert({
      severity: AlertSeverity.CRITICAL,
      proxyAddress,
      ...(proxyName ? { proxyName } : {}),
      implementationAddress: newImplAddress,
      txHash,
      chainId,
      isVerified: false,
      hasStorageLayout: false,
      message,
      rawData: { oldImplAddress, similarContracts },
      analysis: unverifiedAnalysis,
    });
    const swarmUrl = await publishData(unverifiedAlert, block);
    await sendTelegramAlert(unverifiedAlert, swarmUrl ?? undefined);
    await emitAlert(unverifiedAlert, block.number);
    maybeWriteReputation(proxyName, unverifiedAlert.severity, txHash, unverifiedAlert.timestamp);
    return;
  }

  console.log(`[Pipeline] Verified — continuing analysis`);

  // Step 2 — fetch all data in parallel
  console.log(`\n[Pipeline] Step 2/4 — Fetching layouts, ABIs, meta, and NatSpec...`);
  const [oldLayout, newLayout, oldABI, newABI, contractMeta, natSpec] = await Promise.all([
    getStorageLayout(oldImplAddress, chainId),
    getStorageLayout(newImplAddress, chainId),
    getABI(oldImplAddress, chainId),
    getABI(newImplAddress, chainId),
    getContractMeta(newImplAddress, chainId),
    getNatSpec(newImplAddress, chainId),
  ]);

  const hasStorageLayout = !!oldLayout && !!newLayout;
  const hasABI = !!oldABI && !!newABI;
  const matchType = contractMeta?.matchType ?? null;

  console.log(`  Storage layout: ${hasStorageLayout ? "both found" : "incomplete"}`);
  console.log(`  ABI:            ${hasABI ? "both found" : "incomplete"}`);
  console.log(`  NatSpec:        ${natSpec ? `found (${Object.keys(natSpec.methods).length} methods)` : "not found"}`);
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

  if (severityFloor) {
    const floorIdx = SEVERITY_ORDER.indexOf(severityFloor);
    const sevIdx = SEVERITY_ORDER.indexOf(severity);
    if (sevIdx < floorIdx) {
      console.log(
        `[Pipeline] Filtered: ${severity} below threshold ${severityFloor} (set on agent.vigil.eth) — skipping AI + publish`,
      );
      return;
    }
  }

  if (functionRiskFlags.length > 0) {
    console.log(`[Pipeline] Function risk flags:`);
    for (const flag of functionRiskFlags) {
      console.log(`  [${flag.level}] ${flag.message}`);
    }
  }

  // Step 4 — AI analysis
  console.log(`\n[Pipeline] Step 4/5 — AI analysis...`);
  const analysis = await analyseUpgrade({
    proxyAddress,
    oldImplementation: oldImplAddress,
    newImplementation: newImplAddress,
    storageDiff: storageDiff ?? "unavailable",
    abiDiff: abiDiff ?? "unavailable",
    functionRiskFlags,
    severity,
    natSpec,
  });

  console.log('\n[Pipeline] Step 4.5 — Enriching with Apify social context...');
  const apifyEnrichment = await enrichAlert(proxyAddress, newImplAddress);

  const alert = createAlert({
    severity,
    proxyAddress,
    ...(proxyName ? { proxyName } : {}),
    implementationAddress: newImplAddress,
    txHash,
    chainId,
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
    rawData: { storageDiff, abiDiff, functionRiskFlags, matchType, contractMeta, natSpec, block, apifyEnrichment },
    analysis,
  });


    const swarmUrl = await publishData(alert, block);
    await sendTelegramAlert(alert, swarmUrl ?? undefined);


  await emitAlert(alert, block.number);
  maybeWriteReputation(proxyName, alert.severity, txHash, alert.timestamp);
}

async function bootEnsConfig(): Promise<{
  nameResolver: (address: string) => string | null;
  severityFloor: AlertSeverity | null;
  publishedFeedUrl: string | null;
}> {
  if (!hasSepoliaProvider()) {
    console.log("[Vigil/ENS] SEPOLIA_RPC_URL not set — running without ENS identity (no severity filter, no name tagging)");
    return { nameResolver: () => null, severityFloor: null, publishedFeedUrl: null };
  }

  console.log(`[Vigil/ENS] Reading agent identity from ${VIGIL_AGENT_ENS_NAME}...`);
  let severityFloor: AlertSeverity | null = null;
  let publishedFeedUrl: string | null = null;
  try {
    const config = await resolveAgentConfig(VIGIL_AGENT_ENS_NAME);
    if (!config) {
      console.warn(`[Vigil/ENS] No resolver set for ${VIGIL_AGENT_ENS_NAME} — skipping`);
    } else {
      if (config.description) console.log(`  description:   ${config.description}`);
      if (config.url) console.log(`  url:           ${config.url}`);
      if (config.feed) console.log(`  feed:          ${config.feed}`);
      if (config.payment) console.log(`  payment:       ${config.payment}`);
      if (config.severityMin) console.log(`  severity-min:  ${config.severityMin}`);
      if (config.capabilities) {
        console.log(`  capabilities:  watch=${config.capabilities.watch.join(",")} chains=${config.capabilities.chains.join(",")} output=${config.capabilities.output.join(",")}`);
      }
      severityFloor = config.severityMin;
      publishedFeedUrl = config.feed;
    }
  } catch (err) {
    console.warn(`[Vigil/ENS] Failed to resolve ${VIGIL_AGENT_ENS_NAME}:`, err);
  }

  const cache = await loadEnsCache();
  const cacheSize = Object.keys(cache).length;
  console.log(`[Vigil/ENS] Loaded ${cacheSize} target name(s) from data/ens-targets.json`);
  console.log(`[Vigil/ENS] Alert severity floor: ${severityFloor ?? "none (all alerts emitted)"}`);

  return {
    nameResolver: (address: string) => lookupName(cache, address),
    severityFloor,
    publishedFeedUrl,
  };
}

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();

  console.log(`[Vigil] Connected to network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`[Vigil] Current block: ${blockNumber}`);

  const { nameResolver, severityFloor } = await bootEnsConfig();

  await initSwarm();

  await startUpgradeWatcher(
    provider,
    (txHash, proxyAddress, newImplAddress, oldImplAddress, block, proxyName) =>
      processUpgrade(
        txHash,
        proxyAddress,
        newImplAddress,
        oldImplAddress,
        provider,
        block,
        proxyName,
        severityFloor,
      ),
    nameResolver,
  );
}

main().catch((err) => {
  console.error("[Vigil] Fatal startup error:", err);
  process.exit(1);
});
