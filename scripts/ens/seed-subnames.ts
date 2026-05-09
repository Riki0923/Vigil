// One-shot setup: creates agent.vigil.eth + demo.vigil.eth subnames, sets text
// records and the addr[base-sepolia] record, writes data/ens-targets.json.
//
// Prerequisites:
//   1. vigil.eth registered on Ethereum Sepolia by SEPOLIA_OWNER and wrapped in NameWrapper.
//   2. SEPOLIA_RPC_URL and ENS_REGISTRAR_PRIVATE_KEY set in .env (the wallet must own vigil.eth).
//   3. demo-target/deployments/base-sepolia.json exists (proxy address read from there).
//
// Usage: tsx scripts/ens/seed-subnames.ts

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  COIN_TYPE,
  ENS_RESOLVER_ABI,
  ENS_SEPOLIA,
  NAME_WRAPPER_ABI,
  RECORD_KEYS,
  getSepoliaSigner,
  isNameRegistered,
  saveEnsCache,
  type EnsTargetCache,
} from "../../src/ens/index.js";

dotenv.config();

const PARENT_NAME = process.env.VIGIL_PARENT_ENS_NAME ?? "vigil.eth";
const AGENT_LABEL = "agent";
const DEMO_LABEL = "demo";

const DEMO_DEPLOYMENT_PATH = path.join(
  process.cwd(),
  "demo-target",
  "deployments",
  "base-sepolia.json",
);

type DemoDeployment = { proxyAddress: string };

const FUSES = 0;
const TTL = 0n;
const EXPIRY = (1n << 64n) - 1n; // max — inherits parent expiry semantics

async function readDemoProxy(): Promise<string> {
  const raw = await fs.readFile(DEMO_DEPLOYMENT_PATH, "utf8");
  const parsed = JSON.parse(raw) as DemoDeployment;
  if (!parsed.proxyAddress) {
    throw new Error(`No proxyAddress in ${DEMO_DEPLOYMENT_PATH}`);
  }
  return ethers.getAddress(parsed.proxyAddress);
}

function encodeBaseSepoliaAddr(address: string): string {
  // ENSIP-9/-11 encodes EVM addresses as the raw 20-byte hex.
  return ethers.getBytes(address).reduce(
    (hex, b) => hex + b.toString(16).padStart(2, "0"),
    "0x",
  );
}

async function ensureSubnameExists(
  wrapper: ethers.Contract,
  parentNode: string,
  label: string,
  ownerAddress: string,
): Promise<string> {
  const fullName = `${label}.${PARENT_NAME}`;
  const exists = await isNameRegistered(fullName);
  if (exists) {
    console.log(`[seed] ${fullName} already exists — skipping creation`);
    return ethers.namehash(fullName);
  }
  console.log(`[seed] Creating ${fullName}...`);
  const tx = await wrapper.getFunction("setSubnodeRecord")(
    parentNode,
    label,
    ownerAddress,
    ENS_SEPOLIA.publicResolver,
    TTL,
    FUSES,
    EXPIRY,
  );
  await tx.wait();
  console.log(`[seed] ${fullName} created (tx ${tx.hash})`);
  return ethers.namehash(fullName);
}

async function setText(
  resolver: ethers.Contract,
  node: string,
  key: string,
  value: string,
): Promise<void> {
  const tx = await resolver.getFunction("setText")(node, key, value);
  await tx.wait();
  console.log(`  text[${key}] = ${value.length > 60 ? value.slice(0, 57) + "..." : value}`);
}

async function setBaseSepoliaAddr(
  resolver: ethers.Contract,
  node: string,
  address: string,
): Promise<void> {
  const encoded = encodeBaseSepoliaAddr(address);
  const tx = await resolver.getFunction("setAddr(bytes32,uint256,bytes)")(
    node,
    COIN_TYPE.baseSepolia,
    encoded,
  );
  await tx.wait();
  console.log(`  addr[base-sepolia] = ${address}`);
}

async function main(): Promise<void> {
  const signer = getSepoliaSigner();
  const signerAddress = await signer.getAddress();
  console.log(`[seed] Signer: ${signerAddress}`);
  console.log(`[seed] Parent: ${PARENT_NAME}`);

  const parentExists = await isNameRegistered(PARENT_NAME);
  if (!parentExists) {
    throw new Error(
      `${PARENT_NAME} is not registered on Ethereum Sepolia. Register it first via https://app.ens.domains (Sepolia network) using the same wallet as ENS_REGISTRAR_PRIVATE_KEY.`,
    );
  }

  const parentNode = ethers.namehash(PARENT_NAME);
  const wrapper = new ethers.Contract(ENS_SEPOLIA.nameWrapper, NAME_WRAPPER_ABI, signer);
  const resolver = new ethers.Contract(ENS_SEPOLIA.publicResolver, ENS_RESOLVER_ABI, signer);

  // 1. agent subname + records
  const agentNode = await ensureSubnameExists(wrapper, parentNode, AGENT_LABEL, signerAddress);
  console.log(`[seed] Setting records on ${AGENT_LABEL}.${PARENT_NAME}...`);
  await setText(resolver, agentNode, RECORD_KEYS.description, "Vigil — autonomous proxy upgrade auditor");
  await setText(resolver, agentNode, RECORD_KEYS.url, "https://github.com/Riki0923/Vigil");
  await setText(
    resolver,
    agentNode,
    RECORD_KEYS.capabilities,
    JSON.stringify({
      watch: ["proxy-upgrade-eip-1967"],
      chains: ["base", "base-sepolia"],
      output: ["swarm-feed", "json-file"],
    }),
  );
  await setText(resolver, agentNode, RECORD_KEYS.severityMin, "MEDIUM");
  await setText(
    resolver,
    agentNode,
    RECORD_KEYS.payment,
    "x402-planned:https://github.com/Riki0923/Vigil",
  );

  // 2. demo subname + records
  const demoProxy = await readDemoProxy();
  console.log(`[seed] Demo proxy on Base Sepolia: ${demoProxy}`);
  const demoNode = await ensureSubnameExists(wrapper, parentNode, DEMO_LABEL, signerAddress);
  console.log(`[seed] Setting records on ${DEMO_LABEL}.${PARENT_NAME}...`);
  await setText(resolver, demoNode, RECORD_KEYS.description, "Vigil demo proxy — live-upgraded during the pitch");
  await setText(resolver, demoNode, RECORD_KEYS.kind, "demo-proxy");
  await setBaseSepoliaAddr(resolver, demoNode, demoProxy);

  // 3. write the address-to-name cache for the agent's fast tagging path
  const cache: EnsTargetCache = {
    [demoProxy.toLowerCase()]: `${DEMO_LABEL}.${PARENT_NAME}`,
  };
  await saveEnsCache(cache);
  console.log(`[seed] Wrote data/ens-targets.json with ${Object.keys(cache).length} entry`);

  console.log("\n[seed] Done. Next:");
  console.log(`  - Verify on https://app.ens.domains/${AGENT_LABEL}.${PARENT_NAME}?network=sepolia`);
  console.log(`  - Set ENSIP-19 reverse name on Base Sepolia: tsx scripts/ens/set-base-primary.ts`);
}

main().catch((err) => {
  console.error("[seed] Fatal:", err);
  process.exit(1);
});
