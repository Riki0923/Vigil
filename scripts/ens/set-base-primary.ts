// Sets the ENSIP-19 primary (reverse) name on Base Sepolia or Base mainnet for
// the demo proxy, so Base-aware explorers / tools render `demo.<parent>` instead of hex.
//
// L2ReverseRegistrar deployments (verified against ensdomains/ens-contracts):
//   Base Sepolia: 0x00000BeEF055f7934784D6d81b6BC86665630dbA
//   Base mainnet: 0x0000000000D8e504002cC26E3Ec46D81971C1664
//
// The registrar supports three patterns. We use `setNameForOwnableWithSignature`
// because the demo proxy is a UUPS Ownable upgradeable contract, the proxy
// itself doesn't expose a "set my reverse name" method, but ENSIP-19 lets us
// authorize the action via an off-chain signature from `proxy.owner()`.
//
// Usage:
//   tsx scripts/ens/set-base-primary.ts                              (base-sepolia, vigil.eth)
//   tsx scripts/ens/set-base-primary.ts --network=base-mainnet       (base-mainnet, vigilbot.eth)
//   tsx scripts/ens/set-base-primary.ts --network=base-mainnet --name=foo.eth

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { promises as fs } from "node:fs";
import path from "node:path";

import { COIN_TYPE, L2_REVERSE_REGISTRAR_ABI } from "../../src/ens/index.js";

dotenv.config();

type BaseNetwork = "base-sepolia" | "base-mainnet";

type NetworkConfig = {
  chainId: bigint;
  rpcUrl: string | undefined;
  rpcEnvHint: string;
  privateKey: string | undefined;
  pkEnvHint: string;
  reverseRegistrar: string;
  coinType: bigint;
  deploymentSlug: string;
  defaultParentName: string;
};

const SIGNATURE_VALIDITY_SECS = 30 * 60; // 30 min, contract caps at block.timestamp + 1h, must stay strictly under

const PROXY_OWNABLE_ABI = ["function owner() view returns (address)"] as const;

type DemoDeployment = { proxyAddress: string };

function parseNetworkFlag(): BaseNetwork {
  const flag = process.argv.find((a) => a.startsWith("--network="));
  const value = flag ? flag.slice("--network=".length) : "base-sepolia";
  if (value !== "base-sepolia" && value !== "base-mainnet") {
    throw new Error(`--network must be "base-sepolia" or "base-mainnet" (got "${value}")`);
  }
  return value;
}

function parseNameFlag(network: BaseNetwork): string {
  const flag = process.argv.find((a) => a.startsWith("--name="));
  if (flag) {
    const value = flag.slice("--name=".length);
    if (value) return value;
  }
  if (network === "base-mainnet") {
    return process.env.VIGIL_PARENT_ENS_NAME_MAINNET ?? "vigilbot.eth";
  }
  return process.env.VIGIL_PARENT_ENS_NAME ?? "vigil.eth";
}

function getNetworkConfig(network: BaseNetwork): NetworkConfig {
  if (network === "base-mainnet") {
    return {
      chainId: 8453n,
      rpcUrl: process.env.BASE_MAINNET_RPC_URL,
      rpcEnvHint: "BASE_MAINNET_RPC_URL",
      privateKey: process.env.BASE_MAINNET_PRIVATE_KEY ?? process.env.ENS_REGISTRAR_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY,
      pkEnvHint: "BASE_MAINNET_PRIVATE_KEY or ENS_REGISTRAR_PRIVATE_KEY",
      reverseRegistrar: "0x0000000000D8e504002cC26E3Ec46D81971C1664",
      coinType: COIN_TYPE.baseMainnet,
      deploymentSlug: "base-mainnet",
      defaultParentName: "vigilbot.eth",
    };
  }
  return {
    chainId: 84532n,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
    rpcEnvHint: "BASE_SEPOLIA_RPC_URL",
    privateKey: process.env.BASE_SEPOLIA_PRIVATE_KEY ?? process.env.ENS_REGISTRAR_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY,
    pkEnvHint: "BASE_SEPOLIA_PRIVATE_KEY or ENS_REGISTRAR_PRIVATE_KEY",
    reverseRegistrar: process.env.BASE_SEPOLIA_REVERSE_REGISTRAR ?? "0x00000BeEF055f7934784D6d81b6BC86665630dbA",
    coinType: COIN_TYPE.baseSepolia,
    deploymentSlug: "base-sepolia",
    defaultParentName: "vigil.eth",
  };
}

async function main(): Promise<void> {
  const network = parseNetworkFlag();
  const parentName = parseNameFlag(network);
  const demoName = `demo.${parentName}`;
  const cfg = getNetworkConfig(network);

  if (!cfg.rpcUrl) throw new Error(`${cfg.rpcEnvHint} is not set`);
  if (!cfg.privateKey) throw new Error(`${cfg.pkEnvHint} is not set`);

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, Number(cfg.chainId));
  const onChain = await provider.getNetwork();
  if (onChain.chainId !== cfg.chainId) {
    throw new Error(
      `Wrong chain. Expected ${network} (${cfg.chainId}), got chainId ${onChain.chainId}. Set ${cfg.rpcEnvHint}.`,
    );
  }
  const signer = new ethers.Wallet(cfg.privateKey, provider);
  const signerAddr = await signer.getAddress();
  console.log(`[set-primary] Network:   ${network} (chainId ${cfg.chainId})`);
  console.log(`[set-primary] Signer:    ${signerAddr}`);
  console.log(`[set-primary] Registrar: ${cfg.reverseRegistrar}`);
  console.log(`[set-primary] Target:    ${demoName}`);

  const deploymentPath = path.join(
    process.cwd(),
    "demo-target",
    "deployments",
    `${cfg.deploymentSlug}.json`,
  );
  const raw = await fs.readFile(deploymentPath, "utf8");
  const { proxyAddress } = JSON.parse(raw) as DemoDeployment;
  console.log(`[set-primary] Proxy:     ${proxyAddress}`);

  // Verify the signer is the proxy's owner, the registrar will check this.
  const proxy = new ethers.Contract(proxyAddress, PROXY_OWNABLE_ABI, provider);
  const proxyOwner = (await proxy.getFunction("owner")()) as string;
  console.log(`[set-primary] Proxy owner: ${proxyOwner}`);
  if (proxyOwner.toLowerCase() !== signerAddr.toLowerCase()) {
    throw new Error(
      `Signer is not the proxy's owner, registrar will reject. Owner=${proxyOwner}, signer=${signerAddr}.`,
    );
  }

  // L2ReverseRegistrar uses ERC-191 personal_sign (NOT EIP-712).
  // Source: ens-contracts/contracts/reverseRegistrar/L2ReverseRegistrar.sol
  //   keccak256(abi.encodePacked(
  //     address(this), this.setNameForOwnableWithSignature.selector,
  //     contractAddr, owner, signatureExpiry, name, coinTypes
  //   )).toEthSignedMessageHash()
  const expiry = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_VALIDITY_SECS);
  const coinTypes = [cfg.coinType];

  const selector = ethers
    .id("setNameForOwnableWithSignature(address,address,uint256,string,uint256[],bytes)")
    .slice(0, 10);
  const messageHash = ethers.keccak256(
    ethers.solidityPacked(
      ["address", "bytes4", "address", "address", "uint256", "string", "uint256[]"],
      [
        cfg.reverseRegistrar,
        selector,
        proxyAddress,
        signerAddr,
        expiry,
        demoName,
        coinTypes,
      ],
    ),
  );
  const signature = await signer.signMessage(ethers.getBytes(messageHash));
  console.log(`[set-primary] Signature: ${signature}`);

  const registrar = new ethers.Contract(cfg.reverseRegistrar, L2_REVERSE_REGISTRAR_ABI, signer);
  console.log(`[set-primary] Submitting setNameForOwnableWithSignature...`);
  const tx = await registrar.getFunction("setNameForOwnableWithSignature")(
    proxyAddress,
    signerAddr,
    expiry,
    demoName,
    coinTypes,
    signature,
  );
  console.log(`[set-primary] Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[set-primary] Confirmed in block ${receipt?.blockNumber}.`);
  console.log(`[set-primary] ✅ Reverse name set. Verify on a Base ${network === "base-mainnet" ? "mainnet" : "Sepolia"} ENS-aware explorer.`);
}

main().catch((err) => {
  console.error("[set-primary] Fatal:", err.shortMessage ?? err.message);
  process.exit(1);
});
