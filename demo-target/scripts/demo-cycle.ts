import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

import { getNetworkPaths } from "./lib/paths";

const DEMO_TARGET_ROOT = path.join(__dirname, "..");
const V2_CONTRACT_PATH = path.join(DEMO_TARGET_ROOT, "contracts", "DemoTokenV2.sol");

const BUILD_STAMP_REGEX = /string public constant VIGIL_DEMO_BUILD = "[^"]*";/;
const TARGET_DEMO_BALANCE = ethers.parseEther("100");
const MIN_GAS_BALANCE = ethers.parseEther("0.005");

interface PreviousUpgrade {
  v2ImplAddress: string;
  upgradedAt: string;
  upgradeTxHash: string;
  upgradeBlockNumber: number | null;
  note: string;
}

interface DeploymentRecord {
  proxyAddress: string;
  v1ImplAddress: string;
  deployedAt: string;
  deployBlockNumber: number | null;
  deployTxHash?: string;
  v1ImplTxHash?: string;
  v2ImplAddress?: string;
  upgradedAt?: string;
  upgradeTxHash?: string;
  upgradeBlockNumber?: number | null;
  previousUpgrades?: PreviousUpgrade[];
}

async function main(): Promise<void> {
  console.log("[demo-cycle] starting…");

  const paths = getNetworkPaths(hre);
  console.log(`[demo-cycle] network:      ${paths.name} (chainId ${paths.chainId})`);

  if (!fs.existsSync(paths.deploymentsPath)) {
    throw new Error(`No deployment record at ${paths.deploymentsPath}. Run 'npm run deploy${paths.name === "baseMainnet" ? ":mainnet" : ""}' first.`);
  }
  const record: DeploymentRecord = JSON.parse(fs.readFileSync(paths.deploymentsPath, "utf8"));
  if (!record.proxyAddress) throw new Error("No proxyAddress in deployments file.");

  const demoWalletKey = process.env.DEMO_WALLET_PRIVATE_KEY;
  const demoSpender = process.env.DEMO_SPENDER_ADDRESS;
  if (!demoWalletKey) throw new Error("Set DEMO_WALLET_PRIVATE_KEY in .env");
  if (!demoSpender) throw new Error("Set DEMO_SPENDER_ADDRESS in .env");
  if (!/^0x[a-fA-F0-9]{40}$/.test(demoSpender)) {
    throw new Error(`DEMO_SPENDER_ADDRESS is not a valid address: ${demoSpender}`);
  }

  const demoWallet = new ethers.Wallet(demoWalletKey, ethers.provider);
  const demoBalance = await ethers.provider.getBalance(demoWallet.address);
  if (demoBalance < MIN_GAS_BALANCE) {
    console.warn(
      `[demo-cycle] WARN: DEMO_WALLET ETH balance is ${ethers.formatEther(demoBalance)} (< ${ethers.formatEther(MIN_GAS_BALANCE)}); approve may run out of gas.`,
    );
  }

  if (!fs.existsSync(paths.alertsPath)) {
    console.warn(`[demo-cycle] WARN: ${paths.alertsPath} not found — is the watcher running?`);
  }

  console.log(`[demo-cycle] proxy:        ${record.proxyAddress}`);
  console.log(`[demo-cycle] DEMO_WALLET:  ${demoWallet.address}`);
  console.log(`[demo-cycle] DEMO_SPENDER: ${demoSpender}`);

  // ── Bump build stamp ─────────────────────────────────────────
  const v2Source = fs.readFileSync(V2_CONTRACT_PATH, "utf8");
  const matches = v2Source.match(new RegExp(BUILD_STAMP_REGEX, "g"));
  if (!matches || matches.length !== 1) {
    throw new Error(
      `Expected exactly one VIGIL_DEMO_BUILD constant in ${V2_CONTRACT_PATH}; found ${matches?.length ?? 0}`,
    );
  }
  const newStamp = new Date().toISOString();
  const v2Updated = v2Source.replace(
    BUILD_STAMP_REGEX,
    `string public constant VIGIL_DEMO_BUILD = "${newStamp}";`,
  );
  fs.writeFileSync(V2_CONTRACT_PATH, v2Updated);
  console.log(`[demo-cycle] bumped VIGIL_DEMO_BUILD → ${newStamp}`);

  // ── Compile (refresh artifacts so prepareUpgrade picks up new bytecode) ──
  console.log("[demo-cycle] compiling…");
  await hre.run("compile");

  // ── Archive prior upgrade ────────────────────────────────────
  if (record.v2ImplAddress) {
    if (!record.previousUpgrades) record.previousUpgrades = [];
    record.previousUpgrades.push({
      v2ImplAddress: record.v2ImplAddress,
      upgradedAt: record.upgradedAt!,
      upgradeTxHash: record.upgradeTxHash!,
      upgradeBlockNumber: record.upgradeBlockNumber ?? null,
      note: "demo-cycle replay",
    });
    delete record.v2ImplAddress;
    delete record.upgradedAt;
    delete record.upgradeTxHash;
    delete record.upgradeBlockNumber;
    fs.writeFileSync(paths.deploymentsPath, JSON.stringify(record, null, 2));
    console.log(
      `[demo-cycle] archived prior upgrade (now ${record.previousUpgrades.length} in history)`,
    );
  } else {
    console.log("[demo-cycle] no prior upgrade to archive");
  }

  // ── Deploy fresh V2 impl + upgrade proxy ─────────────────────
  console.log("[demo-cycle] preparing fresh V2 impl…");
  const V2 = await ethers.getContractFactory("DemoTokenV2");
  const v2ImplAddress = (await upgrades.prepareUpgrade(record.proxyAddress, V2, {
    kind: "uups",
    unsafeSkipStorageCheck: true,
  })) as string;
  console.log(`[demo-cycle] new V2 impl: ${v2ImplAddress}`);

  console.log("[demo-cycle] calling upgradeToAndCall…");
  const proxy = await ethers.getContractAt("DemoTokenV2", record.proxyAddress);
  const upgradeTx = await proxy.upgradeToAndCall(v2ImplAddress, "0x");
  const receipt = await upgradeTx.wait();
  if (!receipt) throw new Error("upgradeToAndCall returned no receipt");

  record.v2ImplAddress = v2ImplAddress;
  record.upgradedAt = new Date().toISOString();
  record.upgradeTxHash = receipt.hash;
  record.upgradeBlockNumber = receipt.blockNumber;
  fs.writeFileSync(paths.deploymentsPath, JSON.stringify(record, null, 2));
  console.log(`[demo-cycle] upgrade tx: ${receipt.hash} (block ${receipt.blockNumber})`);

  // ── Sourcify verify (best-effort) ────────────────────────────
  console.log("[demo-cycle] verifying V2 impl on Sourcify…");
  try {
    await hre.run("verify:verify", { address: v2ImplAddress, constructorArguments: [] });
    console.log("[demo-cycle] V2 impl verified.");
  } catch (err) {
    console.warn("[demo-cycle] WARN: Sourcify verification failed:", err);
    console.warn(
      `[demo-cycle] Re-run manually: npx hardhat verify --network ${paths.name} ${v2ImplAddress}`,
    );
  }

  // ── Approve from DEMO_WALLET ─────────────────────────────────
  const [owner] = await ethers.getSigners();
  const token = await ethers.getContractAt("DemoTokenV1", record.proxyAddress, owner);

  const existingBalance: bigint = await token.balanceOf(demoWallet.address);
  if (existingBalance < TARGET_DEMO_BALANCE) {
    const need = TARGET_DEMO_BALANCE - existingBalance;
    console.log(`[demo-cycle] minting ${ethers.formatEther(need)} DEMO to demo wallet…`);
    const mintTx = await token.mint(demoWallet.address, need);
    await mintTx.wait();
  } else {
    console.log(
      `[demo-cycle] demo wallet holds ${ethers.formatEther(existingBalance)} DEMO — skipping mint`,
    );
  }

  const tokenAsDemo = token.connect(demoWallet) as typeof token;
  console.log("[demo-cycle] approving DEMO_SPENDER for MaxUint256 from DEMO_WALLET…");
  const approveTx = await tokenAsDemo.approve(demoSpender, ethers.MaxUint256);
  await approveTx.wait();

  let allowance: bigint = 0n;
  for (let attempt = 1; attempt <= 3; attempt++) {
    allowance = await token.allowance(demoWallet.address, demoSpender);
    if (allowance > 0n) break;
    console.log(`[demo-cycle] allowance read returned 0; retrying (${attempt}/3)…`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (allowance === 0n) {
    throw new Error("allowance is still 0 after 3 retries — approve may have failed");
  }

  // ── Summary ──────────────────────────────────────────────────
  const allowanceLabel =
    allowance === ethers.MaxUint256 ? "MaxUint256" : allowance.toString();
  const networkLabel = paths.name === "baseMainnet" ? "Base mainnet" : "Base Sepolia";
  console.log("");
  console.log(`[demo-cycle] proxy:           ${record.proxyAddress}`);
  console.log(`[demo-cycle] new V2 impl:     ${v2ImplAddress}`);
  console.log(`[demo-cycle] upgrade tx:      ${receipt.hash}`);
  console.log(`[demo-cycle] upgrade block:   ${receipt.blockNumber}`);
  console.log(`[demo-cycle] DEMO_WALLET:     ${demoWallet.address}`);
  console.log(`[demo-cycle] allowance:       ${allowanceLabel}`);
  console.log(
    `[demo-cycle] modified files:  contracts/DemoTokenV2.sol, deployments/${paths.slug}.json`,
  );
  console.log(
    `[demo-cycle] next: open the UI on ${networkLabel}, disconnect any wallet, click Revoke.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
