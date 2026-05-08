import hre, { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_PATH = path.join(
  __dirname,
  "..",
  "deployments",
  "base-sepolia.json",
);

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
  if (!fs.existsSync(DEPLOYMENTS_PATH)) {
    console.error(`[trigger-upgrade] No deployments file at ${DEPLOYMENTS_PATH}`);
    console.error("[trigger-upgrade] Run scripts/deploy-proxy.ts first.");
    process.exit(1);
  }

  const record: DeploymentRecord = JSON.parse(
    fs.readFileSync(DEPLOYMENTS_PATH, "utf8"),
  );

  if (record.v2ImplAddress) {
    console.log("[trigger-upgrade] Proxy already upgraded to V2:");
    console.log(JSON.stringify(record, null, 2));
    console.log(
      "[trigger-upgrade] Delete deployments/base-sepolia.json and re-deploy to start over.",
    );
    return;
  }

  const [signer] = await ethers.getSigners();
  console.log(`[trigger-upgrade] Signer: ${signer.address}`);
  console.log(`[trigger-upgrade] Proxy:  ${record.proxyAddress}`);

  console.log("[trigger-upgrade] Deploying V2 impl (storage check skipped)...");
  const V2 = await ethers.getContractFactory("DemoTokenV2");
  const v2ImplAddress = (await upgrades.prepareUpgrade(
    record.proxyAddress,
    V2,
    { kind: "uups", unsafeSkipStorageCheck: true },
  )) as string;
  console.log(`[trigger-upgrade] V2 impl: ${v2ImplAddress}`);

  console.log("[trigger-upgrade] Calling upgradeToAndCall on the proxy...");
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

  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(record, null, 2));

  console.log(`[trigger-upgrade] Tx:     ${record.upgradeTxHash}`);
  console.log(`[trigger-upgrade] Block:  ${record.upgradeBlockNumber}`);

  console.log("[trigger-upgrade] Verifying V2 impl on Sourcify...");
  try {
    await hre.run("verify:verify", {
      address: v2ImplAddress,
      constructorArguments: [],
    });
    console.log("[trigger-upgrade] V2 impl verified.");
  } catch (err) {
    console.warn("[trigger-upgrade] Sourcify verification failed:", err);
    console.warn(
      `[trigger-upgrade] Re-run manually: npx hardhat verify --network baseSepolia ${v2ImplAddress}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
