import hre, { ethers } from "hardhat";
import * as fs from "fs";

import { getNetworkPaths } from "./lib/paths";
import { makeLogger } from "./lib/log";

const log = makeLogger("seed");

interface DeploymentRecord {
  proxyAddress: string;
  v1ImplAddress: string;
  v2ImplAddress?: string;
}

async function main(): Promise<void> {
  const paths = getNetworkPaths(hre);
  log.start(`Network:    ${paths.name} (chainId ${paths.chainId})`);

  if (!fs.existsSync(paths.deploymentsPath)) {
    throw new Error(
      `No deployment record at ${paths.deploymentsPath}. Run 'npm run deploy${paths.name === "baseMainnet" ? ":mainnet" : ""}' first.`,
    );
  }

  const record: DeploymentRecord = JSON.parse(fs.readFileSync(paths.deploymentsPath, "utf8"));
  const proxyAddress = record.proxyAddress;
  if (!proxyAddress) throw new Error("No proxyAddress in deployments file.");

  const demoWalletKey = process.env.DEMO_WALLET_PRIVATE_KEY;
  const demoSpender = process.env.DEMO_SPENDER_ADDRESS;
  if (!demoWalletKey) throw new Error("Set DEMO_WALLET_PRIVATE_KEY in .env");
  if (!demoSpender) throw new Error("Set DEMO_SPENDER_ADDRESS in .env");
  if (!/^0x[a-fA-F0-9]{40}$/.test(demoSpender)) {
    throw new Error(`DEMO_SPENDER_ADDRESS is not a valid address: ${demoSpender}`);
  }

  const [owner] = await ethers.getSigners();
  const demoWallet = new ethers.Wallet(demoWalletKey, ethers.provider);
  log.info(`proxy:      ${proxyAddress}`);
  log.info(`owner:      ${owner.address}`);
  log.info(`demoWallet: ${demoWallet.address}`);
  log.info(`spender:    ${demoSpender}`);

  const ownerBalance = await ethers.provider.getBalance(owner.address);
  const demoBalance = await ethers.provider.getBalance(demoWallet.address);
  log.info(`owner ETH:      ${ethers.formatEther(ownerBalance)}`);
  log.info(`demoWallet ETH: ${ethers.formatEther(demoBalance)}`);
  if (demoBalance === 0n) {
    throw new Error(
      `Demo wallet ${demoWallet.address} has 0 ETH on ${paths.name}. Fund it${paths.name === "baseSepolia" ? " from a faucet" : ""} first.`,
    );
  }

  const token = await ethers.getContractAt("DemoTokenV1", proxyAddress, owner);

  const existingBalance: bigint = await token.balanceOf(demoWallet.address);
  const targetBalance = ethers.parseEther("1000");
  const approvalAmount = ethers.parseEther("1000");
  if (existingBalance < targetBalance) {
    const mintAmount = targetBalance - existingBalance;
    log.seed(`minting ${ethers.formatEther(mintAmount)} VIGIL to demo wallet…`);
    const mintTx = await token.mint(demoWallet.address, mintAmount);
    await mintTx.wait();
    log.tx(`mint tx: ${mintTx.hash}`);
  } else {
    log.info(
      `demo wallet already holds ${ethers.formatEther(existingBalance)} VIGIL, skipping mint`,
    );
  }

  log.sign(
    `approving spender for ${ethers.formatEther(approvalAmount)} VIGIL from demo wallet…`,
  );
  const tokenAsDemo = token.connect(demoWallet) as typeof token;
  const approveTx = await tokenAsDemo.approve(demoSpender, approvalAmount);
  await approveTx.wait();
  log.tx(`approve tx: ${approveTx.hash}`);

  const allowance: bigint = await token.allowance(demoWallet.address, demoSpender);
  const balance: bigint = await token.balanceOf(demoWallet.address);
  log.info(`post-state:`);
  log.info(`  balance:   ${ethers.formatEther(balance)} VIGIL`);
  log.info(`  allowance: ${ethers.formatEther(allowance)} VIGIL`);
  log.ok("done.");
}

main().catch((err) => {
  log.error("seed failed", err);
  process.exit(1);
});
