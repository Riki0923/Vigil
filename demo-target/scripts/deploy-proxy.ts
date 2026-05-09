import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

import { getNetworkPaths } from "./lib/paths";
import { makeLogger } from "./lib/log";

const log = makeLogger("deploy-proxy");

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
  const paths = getNetworkPaths(hre);
  log.start(`Network:  ${paths.name} (chainId ${paths.chainId})`);

  if (fs.existsSync(paths.deploymentsPath)) {
    const existing: DeploymentRecord = JSON.parse(
      fs.readFileSync(paths.deploymentsPath, "utf8"),
    );
    log.info("Existing deployment found:");
    log.info(JSON.stringify(existing, null, 2));
    log.hint(
      `Skipping deploy. Delete ${path.relative(process.cwd(), paths.deploymentsPath)} to redeploy.`,
    );
    return;
  }

  const [deployer] = await ethers.getSigners();
  log.info(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  log.info(`Balance:  ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error(
      `Deployer has 0 ETH on ${paths.name}. Fund the wallet${paths.name === "baseSepolia" ? " from a faucet" : ""} first.`,
    );
  }

  const initialSupply = ethers.parseEther("1000");
  const mintCap = ethers.parseEther("1000000");

  log.step("Deploying V1 + UUPS proxy...");
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

  fs.mkdirSync(path.dirname(paths.deploymentsPath), { recursive: true });
  fs.writeFileSync(paths.deploymentsPath, JSON.stringify(record, null, 2));

  log.deploy(`Proxy:    ${proxyAddress}`);
  log.deploy(`V1 impl:  ${v1ImplAddress}`);
  log.info(`Block:    ${record.deployBlockNumber}`);
  log.info(`Explorer: ${paths.explorerBase}/address/${proxyAddress}`);

  log.step("Verifying V1 impl on Sourcify...");
  try {
    await hre.run("verify:verify", {
      address: v1ImplAddress,
      constructorArguments: [],
    });
    log.ok("V1 impl verified.");
  } catch (err) {
    log.warn(`Sourcify verification failed: ${err instanceof Error ? err.message : String(err)}`);
    log.hint(
      `Re-run manually: npx hardhat verify --network ${paths.name} ${v1ImplAddress}`,
    );
  }
}

main().catch((err) => {
  log.error("deploy-proxy failed", err);
  process.exit(1);
});
