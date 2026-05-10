import hre, { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

import { getNetworkPaths } from "./lib/paths";
import { makeLogger } from "./lib/log";

const log = makeLogger("demo-cycle");

const DEMO_TARGET_ROOT = path.join(__dirname, "..");
const V2_CONTRACT_PATH = path.join(DEMO_TARGET_ROOT, "contracts", "DemoTokenV2.sol");

const BUILD_STAMP_REGEX = /string public constant VIGIL_DEMO_BUILD = "[^"]*";/;
const TARGET_DEMO_BALANCE = ethers.parseEther("1000");
const APPROVAL_AMOUNT = ethers.parseEther("1000");
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
  log.start("starting…");

  const paths = getNetworkPaths(hre);
  log.info(`network:      ${paths.name} (chainId ${paths.chainId})`);

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
    log.warn(
      `DEMO_WALLET ETH balance is ${ethers.formatEther(demoBalance)} (< ${ethers.formatEther(MIN_GAS_BALANCE)}); approve may run out of gas.`,
    );
  }

  if (!fs.existsSync(paths.alertsPath)) {
    log.warn(`${paths.alertsPath} not found, is the watcher running?`);
  }

  log.info(`proxy:        ${record.proxyAddress}`);
  log.info(`DEMO_WALLET:  ${demoWallet.address}`);
  log.info(`DEMO_SPENDER: ${demoSpender}`);

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
  log.step(`bumped VIGIL_DEMO_BUILD → ${newStamp}`);

  // ── Compile (refresh artifacts so prepareUpgrade picks up new bytecode) ──
  log.step("compiling…");
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
    log.step(
      `archived prior upgrade (now ${record.previousUpgrades.length} in history)`,
    );
  } else {
    log.info("no prior upgrade to archive");
  }

  // ── Deploy fresh V2 impl + upgrade proxy ─────────────────────
  // We deploy the impl directly with the contract factory instead of going
  // through upgrades.prepareUpgrade, because we deliberately want a "malicious"
  // V2 to land on the proxy each cycle, OZ's safety checks would either reject
  // it (storage layout, unsafe modifiers) or fail the manifest registration
  // step in ways that are noisy and unhelpful for a pitch demo. The proxy is
  // UUPS, so any subsequent valid upgrade call still works through the same
  // implementation.
  log.step("deploying fresh V2 impl…");
  const V2 = await ethers.getContractFactory("DemoTokenV2");
  const v2 = await V2.deploy();
  await v2.waitForDeployment();
  const v2ImplAddress = await v2.getAddress();
  log.deploy(`new V2 impl: ${v2ImplAddress}`);

  log.step("calling upgradeToAndCall…");
  const proxy = await ethers.getContractAt("DemoTokenV2", record.proxyAddress);
  const upgradeTx = await proxy.upgradeToAndCall(v2ImplAddress, "0x");
  const receipt = await upgradeTx.wait();
  if (!receipt) throw new Error("upgradeToAndCall returned no receipt");

  record.v2ImplAddress = v2ImplAddress;
  record.upgradedAt = new Date().toISOString();
  record.upgradeTxHash = receipt.hash;
  record.upgradeBlockNumber = receipt.blockNumber;
  fs.writeFileSync(paths.deploymentsPath, JSON.stringify(record, null, 2));
  log.tx(`upgrade tx: ${receipt.hash} (block ${receipt.blockNumber})`);

  // ── Sourcify verify (best-effort) ────────────────────────────
  log.step("verifying V2 impl on Sourcify…");
  try {
    await hre.run("verify:verify", { address: v2ImplAddress, constructorArguments: [] });
    log.ok("V2 impl verified.");
  } catch (err) {
    log.warn(`Sourcify verification failed: ${err instanceof Error ? err.message : String(err)}`);
    log.hint(
      `Re-run manually: npx hardhat verify --network ${paths.name} ${v2ImplAddress}`,
    );
  }

  // ── Approve from DEMO_WALLET ─────────────────────────────────
  const [owner] = await ethers.getSigners();
  const token = await ethers.getContractAt("DemoTokenV1", record.proxyAddress, owner);

  const existingBalance: bigint = await token.balanceOf(demoWallet.address);
  if (existingBalance < TARGET_DEMO_BALANCE) {
    const need = TARGET_DEMO_BALANCE - existingBalance;
    log.step(`minting ${ethers.formatEther(need)} VIGIL to demo wallet…`);
    const mintTx = await token.mint(demoWallet.address, need);
    await mintTx.wait();
  } else {
    log.info(
      `demo wallet holds ${ethers.formatEther(existingBalance)} VIGIL, skipping mint`,
    );
  }

  const tokenAsDemo = token.connect(demoWallet) as typeof token;
  log.sign(
    `approving DEMO_SPENDER for ${ethers.formatEther(APPROVAL_AMOUNT)} VIGIL from DEMO_WALLET…`,
  );
  const approveTx = await tokenAsDemo.approve(demoSpender, APPROVAL_AMOUNT);
  await approveTx.wait();

  let allowance: bigint = 0n;
  for (let attempt = 1; attempt <= 3; attempt++) {
    allowance = await token.allowance(demoWallet.address, demoSpender);
    if (allowance > 0n) break;
    log.warn(`allowance read returned 0; retrying (${attempt}/3)…`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (allowance === 0n) {
    throw new Error("allowance is still 0 after 3 retries, approve may have failed");
  }

  // ── Summary ──────────────────────────────────────────────────
  const allowanceLabel =
    allowance === ethers.MaxUint256
      ? "MaxUint256"
      : `${ethers.formatEther(allowance)} VIGIL`;
  const networkLabel = paths.name === "baseMainnet" ? "Base mainnet" : "Base Sepolia";
  console.log("");
  log.info(`proxy:           ${record.proxyAddress}`);
  log.info(`new V2 impl:     ${v2ImplAddress}`);
  log.info(`upgrade tx:      ${receipt.hash}`);
  log.info(`upgrade block:   ${receipt.blockNumber}`);
  log.info(`DEMO_WALLET:     ${demoWallet.address}`);
  log.info(`allowance:       ${allowanceLabel}`);
  log.info(
    `modified files:  contracts/DemoTokenV2.sol, deployments/${paths.slug}.json`,
  );
  log.hint(
    `next: open the UI on ${networkLabel}, disconnect any wallet, click Revoke.`,
  );
}

main().catch((err) => {
  log.error("demo-cycle failed", err);
  process.exit(1);
});
