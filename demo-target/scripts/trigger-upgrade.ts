import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

import { getNetworkPaths } from "./lib/paths";
import { makeLogger } from "./lib/log";

const log = makeLogger("trigger-upgrade");

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
  log.start(`Network: ${paths.name} (chainId ${paths.chainId})`);

  if (!fs.existsSync(paths.deploymentsPath)) {
    log.error(`No deployments file at ${paths.deploymentsPath}`);
    log.hint(`Run: npx hardhat run scripts/deploy-proxy.ts --network ${paths.name}`);
    process.exit(1);
  }

  const record: DeploymentRecord = JSON.parse(
    fs.readFileSync(paths.deploymentsPath, "utf8"),
  );

  if (record.v2ImplAddress) {
    log.info("Proxy already upgraded to V2:");
    log.info(JSON.stringify(record, null, 2));
    log.hint(
      `Delete ${path.relative(process.cwd(), paths.deploymentsPath)} and re-deploy to start over.`,
    );
    return;
  }

  const [signer] = await ethers.getSigners();
  log.info(`Signer: ${signer.address}`);
  log.info(`Proxy:  ${record.proxyAddress}`);

  log.step("Deploying V2 impl (storage check skipped)...");
  const V2 = await ethers.getContractFactory("DemoTokenV2");
  const v2ImplAddress = (await upgrades.prepareUpgrade(
    record.proxyAddress,
    V2,
    { kind: "uups", unsafeSkipStorageCheck: true },
  )) as string;
  log.deploy(`V2 impl: ${v2ImplAddress}`);

  log.step("Calling upgradeToAndCall on the proxy...");
  const proxy = await ethers.getContractAt("DemoTokenV2", record.proxyAddress);
  const upgradeTx = await proxy.upgradeToAndCall(v2ImplAddress, "0x");
  const receipt = await upgradeTx.wait();
  if (!receipt) {
    throw new Error("upgradeToAndCall returned no receipt");
  }

  record.v2ImplAddress = v2ImplAddress;
  record.upgradedAt = new Date().toISOString();
  record.upgradeTxHash = receipt.hash;
  record.upgradeBlockNumber = receipt.blockNumber;

  fs.writeFileSync(paths.deploymentsPath, JSON.stringify(record, null, 2));

  log.tx(`Tx:     ${record.upgradeTxHash}`);
  log.info(`Block:  ${record.upgradeBlockNumber}`);
  log.info(`Explorer: ${paths.explorerBase}/tx/${record.upgradeTxHash}`);

  log.step("Verifying V2 impl on Sourcify...");
  try {
    await hre.run("verify:verify", {
      address: v2ImplAddress,
      constructorArguments: [],
    });
    log.ok("V2 impl verified.");
  } catch (err) {
    log.warn(`Sourcify verification failed: ${err instanceof Error ? err.message : String(err)}`);
    log.hint(
      `Re-run manually: npx hardhat verify --network ${paths.name} ${v2ImplAddress}`,
    );
  }
}

main().catch((err) => {
  log.error("trigger-upgrade failed", err);
  process.exit(1);
});
