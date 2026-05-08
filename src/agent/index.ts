import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { startUpgradeWatcher } from "../watchers/upgradeWatcher.js"; // .js resolves to .ts at runtime

dotenv.config();

const RPC_URL = process.env.RPC_URL!;

export async function processUpgrade(
  txHash: string,
  proxyAddress: string,
  implAddress: string
): Promise<void> {
  console.log(`[Vigil] Processing upgrade`);
  console.log(`  Tx:             ${txHash}`);
  console.log(`  Proxy:          ${proxyAddress}`);
  console.log(`  Implementation: ${implAddress}`);
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
