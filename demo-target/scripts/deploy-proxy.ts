import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments");
const DEPLOYMENTS_PATH = path.join(DEPLOYMENTS_DIR, "base-sepolia.json");

interface DeploymentRecord {
  proxyAddress: string;
  v1ImplAddress: string;
  deployedAt: string;
  deployBlockNumber: number | null;
  v2ImplAddress?: string;
  upgradedAt?: string;
  upgradeTxHash?: string;
  upgradeBlockNumber?: number | null;
}

async function main(): Promise<void> {
  if (fs.existsSync(DEPLOYMENTS_PATH)) {
    const existing: DeploymentRecord = JSON.parse(
      fs.readFileSync(DEPLOYMENTS_PATH, "utf8"),
    );
    console.log("[deploy-proxy] Existing deployment found:");
    console.log(JSON.stringify(existing, null, 2));
    console.log(
      "[deploy-proxy] Skipping deploy. Delete deployments/base-sepolia.json to redeploy.",
    );
    return;
  }

  const [deployer] = await ethers.getSigners();
  console.log(`[deploy-proxy] Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`[deploy-proxy] Balance:  ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has 0 ETH on Base Sepolia. Fund the wallet from a faucet first.",
    );
  }

  const initialSupply = ethers.parseEther("1000");
  const mintCap = ethers.parseEther("1000000");

  console.log("[deploy-proxy] Deploying V1 + UUPS proxy...");
  const V1 = await ethers.getContractFactory("DemoTokenV1");
  const proxy = await upgrades.deployProxy(
    V1,
    [deployer.address, initialSupply, mintCap],
    { kind: "uups" },
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const v1ImplAddress =
    await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const deployTx = proxy.deploymentTransaction();
  const deployReceipt = deployTx ? await deployTx.wait() : null;

  const record: DeploymentRecord = {
    proxyAddress,
    v1ImplAddress,
    deployedAt: new Date().toISOString(),
    deployBlockNumber: deployReceipt?.blockNumber ?? null,
  };

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(record, null, 2));

  console.log(`[deploy-proxy] Proxy:    ${proxyAddress}`);
  console.log(`[deploy-proxy] V1 impl:  ${v1ImplAddress}`);
  console.log(`[deploy-proxy] Block:    ${record.deployBlockNumber}`);

  console.log("[deploy-proxy] Verifying V1 impl on Sourcify...");
  try {
    await hre.run("verify:verify", {
      address: v1ImplAddress,
      constructorArguments: [],
    });
    console.log("[deploy-proxy] V1 impl verified.");
  } catch (err) {
    console.warn("[deploy-proxy] Sourcify verification failed:", err);
    console.warn(
      `[deploy-proxy] Re-run manually: npx hardhat verify --network baseSepolia ${v1ImplAddress}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
