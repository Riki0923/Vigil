import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_PATH = path.join(__dirname, "..", "deployments", "base-sepolia.json");

interface DeploymentRecord {
  proxyAddress: string;
  v1ImplAddress: string;
  v2ImplAddress?: string;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DEPLOYMENTS_PATH)) {
    throw new Error(
      `No deployment record at ${DEPLOYMENTS_PATH}. Run 'npm run deploy' first.`,
    );
  }

  const record: DeploymentRecord = JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, "utf8"));
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
  console.log(`[seed] proxy:      ${proxyAddress}`);
  console.log(`[seed] owner:      ${owner.address}`);
  console.log(`[seed] demoWallet: ${demoWallet.address}`);
  console.log(`[seed] spender:    ${demoSpender}`);

  const ownerBalance = await ethers.provider.getBalance(owner.address);
  const demoBalance = await ethers.provider.getBalance(demoWallet.address);
  console.log(`[seed] owner ETH:      ${ethers.formatEther(ownerBalance)}`);
  console.log(`[seed] demoWallet ETH: ${ethers.formatEther(demoBalance)}`);
  if (demoBalance === 0n) {
    throw new Error(
      `Demo wallet ${demoWallet.address} has 0 ETH on Base Sepolia. Fund it from a faucet first.`,
    );
  }

  const token = await ethers.getContractAt("DemoTokenV1", proxyAddress, owner);

  const existingBalance: bigint = await token.balanceOf(demoWallet.address);
  const targetBalance = ethers.parseEther("100");
  if (existingBalance < targetBalance) {
    const mintAmount = targetBalance - existingBalance;
    console.log(`[seed] minting ${ethers.formatEther(mintAmount)} DEMO to demo wallet…`);
    const mintTx = await token.mint(demoWallet.address, mintAmount);
    await mintTx.wait();
    console.log(`[seed] mint tx: ${mintTx.hash}`);
  } else {
    console.log(
      `[seed] demo wallet already holds ${ethers.formatEther(existingBalance)} DEMO — skipping mint`,
    );
  }

  console.log(`[seed] approving spender for MAX from demo wallet…`);
  const tokenAsDemo = token.connect(demoWallet) as typeof token;
  const approveTx = await tokenAsDemo.approve(demoSpender, ethers.MaxUint256);
  await approveTx.wait();
  console.log(`[seed] approve tx: ${approveTx.hash}`);

  const allowance: bigint = await token.allowance(demoWallet.address, demoSpender);
  const balance: bigint = await token.balanceOf(demoWallet.address);
  console.log(`[seed] post-state:`);
  console.log(`[seed]   balance:   ${ethers.formatEther(balance)} DEMO`);
  console.log(`[seed]   allowance: ${allowance.toString()}`);
  console.log(`[seed] done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
