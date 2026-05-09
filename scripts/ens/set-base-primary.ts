// Sets the ENSIP-19 primary (reverse) name on Base Sepolia for the demo proxy,
// so Base-Sepolia-aware explorers / tools render `demo.vigil.eth` instead of hex.
//
// The Base Sepolia L2ReverseRegistrar (0x00000BeEF055f7934784D6d81b6BC86665630dbA,
// verified from ensdomains/ens-contracts/deployments/baseSepolia/L2ReverseRegistrar.json)
// supports three patterns. We use #3 because the demo proxy is an UUPS Ownable
// upgradeable contract — the proxy itself doesn't expose a "set my reverse name"
// method, but ENSIP-19 lets us authorize the action via an off-chain signature
// from `proxy.owner()` (the deployer wallet, also the ENS_REGISTRAR_PRIVATE_KEY).
//
// 1. setName(name) — caller sets their own reverse (would only work for an EOA)
// 2. setNameForAddrWithSignature — for arbitrary EOAs, signed by that EOA
// 3. setNameForOwnableWithSignature — for Ownable contracts, signed by their owner ← used here
//
// Usage: tsx scripts/ens/set-base-primary.ts

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  COIN_TYPE,
  L2_REVERSE_REGISTRAR_ABI,
} from "../../src/ens/index.js";

dotenv.config();

const BASE_SEPOLIA_REVERSE_REGISTRAR =
  process.env.BASE_SEPOLIA_REVERSE_REGISTRAR ?? "0x00000BeEF055f7934784D6d81b6BC86665630dbA";

const PARENT_NAME = process.env.VIGIL_PARENT_ENS_NAME ?? "vigil.eth";
const DEMO_NAME = `demo.${PARENT_NAME}`;
const SIGNATURE_VALIDITY_SECS = 30 * 60; // 30 min — contract caps at block.timestamp + 1h, must stay strictly under

const DEMO_DEPLOYMENT_PATH = path.join(
  process.cwd(),
  "demo-target",
  "deployments",
  "base-sepolia.json",
);

const PROXY_OWNABLE_ABI = ["function owner() view returns (address)"] as const;

type DemoDeployment = { proxyAddress: string };

async function main(): Promise<void> {
  const rpc = process.env.BASE_SEPOLIA_RPC_URL ?? process.env.RPC_URL;
  const pk = process.env.BASE_SEPOLIA_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpc) throw new Error("BASE_SEPOLIA_RPC_URL (or RPC_URL) is not set");
  if (!pk) throw new Error("BASE_SEPOLIA_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is not set");

  const provider = new ethers.JsonRpcProvider(rpc, 84532);
  const network = await provider.getNetwork();
  if (network.chainId !== 84532n) {
    throw new Error(
      `Wrong chain. Expected Base Sepolia (84532), got chainId ${network.chainId}. Set BASE_SEPOLIA_RPC_URL.`,
    );
  }
  const signer = new ethers.Wallet(pk, provider);
  const signerAddr = await signer.getAddress();
  console.log(`[set-primary] Signer:    ${signerAddr}`);
  console.log(`[set-primary] Registrar: ${BASE_SEPOLIA_REVERSE_REGISTRAR}`);
  console.log(`[set-primary] Target:    ${DEMO_NAME}`);

  const raw = await fs.readFile(DEMO_DEPLOYMENT_PATH, "utf8");
  const { proxyAddress } = JSON.parse(raw) as DemoDeployment;
  console.log(`[set-primary] Proxy:     ${proxyAddress}`);

  // Verify the signer is the proxy's owner — the registrar will check this.
  const proxy = new ethers.Contract(proxyAddress, PROXY_OWNABLE_ABI, provider);
  const proxyOwner = (await proxy.getFunction("owner")()) as string;
  console.log(`[set-primary] Proxy owner: ${proxyOwner}`);
  if (proxyOwner.toLowerCase() !== signerAddr.toLowerCase()) {
    throw new Error(
      `Signer is not the proxy's owner — registrar will reject. Owner=${proxyOwner}, signer=${signerAddr}.`,
    );
  }

  // L2ReverseRegistrar uses ERC-191 personal_sign (NOT EIP-712).
  // Source: ens-contracts/contracts/reverseRegistrar/L2ReverseRegistrar.sol
  //   keccak256(abi.encodePacked(
  //     address(this), this.setNameForOwnableWithSignature.selector,
  //     contractAddr, owner, signatureExpiry, name, coinTypes
  //   )).toEthSignedMessageHash()
  const expiry = BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_VALIDITY_SECS);
  const coinTypes = [COIN_TYPE.baseSepolia];

  const selector = ethers
    .id("setNameForOwnableWithSignature(address,address,uint256,string,uint256[],bytes)")
    .slice(0, 10);
  const messageHash = ethers.keccak256(
    ethers.solidityPacked(
      ["address", "bytes4", "address", "address", "uint256", "string", "uint256[]"],
      [
        BASE_SEPOLIA_REVERSE_REGISTRAR,
        selector,
        proxyAddress,
        signerAddr,
        expiry,
        DEMO_NAME,
        coinTypes,
      ],
    ),
  );
  const signature = await signer.signMessage(ethers.getBytes(messageHash));
  console.log(`[set-primary] Signature: ${signature}`);

  const registrar = new ethers.Contract(
    BASE_SEPOLIA_REVERSE_REGISTRAR,
    L2_REVERSE_REGISTRAR_ABI,
    signer,
  );
  console.log(`[set-primary] Submitting setNameForOwnableWithSignature...`);
  const tx = await registrar.getFunction("setNameForOwnableWithSignature")(
    proxyAddress,
    signerAddr,
    expiry,
    DEMO_NAME,
    coinTypes,
    signature,
  );
  console.log(`[set-primary] Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[set-primary] Confirmed in block ${receipt?.blockNumber}.`);
  console.log(
    `[set-primary] ✅ Reverse name set. Verify on a Base Sepolia ENS-aware explorer.`,
  );
}

main().catch((err) => {
  console.error("[set-primary] Fatal:", err.shortMessage ?? err.message);
  process.exit(1);
});
