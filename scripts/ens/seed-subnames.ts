// Creates the agent + demo subnames under the parent ENS name and sets text/addr records.
// Sepolia path: agent.vigil.eth + demo.vigil.eth (with addr[base-sepolia] from
// demo-target/deployments/base-sepolia.json) and writes data/ens-targets.json.
// Mainnet path: agent.vigilbot.eth only, demo subname is skipped until a Base
// mainnet demo proxy exists.
//
// Prerequisites:
//   1. Parent name registered + wrapped (run register-parent.ts first).
//   2. ENS_REGISTRAR_PRIVATE_KEY set, owner of the parent name.
//   3. SEPOLIA_RPC_URL or MAINNET_RPC_URL set (depending on --network).
//
// Usage:
//   tsx scripts/ens/seed-subnames.ts                              (sepolia, vigil.eth)
//   tsx scripts/ens/seed-subnames.ts --network=mainnet            (mainnet, vigilbot.eth, agent only)
//   tsx scripts/ens/seed-subnames.ts --network=mainnet --name=foo.eth

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  COIN_TYPE,
  ENS_RESOLVER_ABI,
  NAME_WRAPPER_ABI,
  RECORD_KEYS,
  getEnsContracts,
  getEnsSigner,
  isNameRegistered,
  saveEnsCache,
  type EnsNetwork,
  type EnsTargetCache,
} from "../../src/ens/index.js";

dotenv.config();

const AGENT_LABEL = "agent";
const DEMO_LABEL = "demo";

type DemoDeployment = { proxyAddress: string };

function demoDeploymentPath(slug: "base-sepolia" | "base-mainnet"): string {
  return path.join(process.cwd(), "demo-target", "deployments", `${slug}.json`);
}

const FUSES = 0;
const TTL = 0n;
const EXPIRY = (1n << 64n) - 1n; // max, inherits parent expiry semantics

function parseNetworkFlag(): EnsNetwork {
  const flag = process.argv.find((a) => a.startsWith("--network="));
  const value = flag ? flag.slice("--network=".length) : "sepolia";
  if (value !== "sepolia" && value !== "mainnet") {
    throw new Error(`--network must be "sepolia" or "mainnet" (got "${value}")`);
  }
  return value;
}

function parseNameFlag(network: EnsNetwork): string {
  const flag = process.argv.find((a) => a.startsWith("--name="));
  if (flag) {
    const value = flag.slice("--name=".length);
    if (value) return value;
  }
  if (network === "mainnet") {
    return process.env.VIGIL_PARENT_ENS_NAME_MAINNET ?? "vigilbot.eth";
  }
  return process.env.VIGIL_PARENT_ENS_NAME ?? "vigil.eth";
}

async function readDemoProxy(deploymentPath: string): Promise<string> {
  const raw = await fs.readFile(deploymentPath, "utf8");
  const parsed = JSON.parse(raw) as DemoDeployment;
  if (!parsed.proxyAddress) {
    throw new Error(`No proxyAddress in ${deploymentPath}`);
  }
  return ethers.getAddress(parsed.proxyAddress);
}

function encodeAddrBytes(address: string): string {
  // ENSIP-9/-11 encodes EVM addresses as the raw 20-byte hex.
  return ethers.getBytes(address).reduce(
    (hex, b) => hex + b.toString(16).padStart(2, "0"),
    "0x",
  );
}

async function ensureSubnameExists(
  wrapper: ethers.Contract,
  resolverAddress: string,
  parentNode: string,
  parentName: string,
  label: string,
  ownerAddress: string,
  network: EnsNetwork,
): Promise<string> {
  const fullName = `${label}.${parentName}`;
  const exists = await isNameRegistered(fullName, network);
  if (exists) {
    console.log(`[seed] ${fullName} already exists, skipping creation`);
    return ethers.namehash(fullName);
  }
  console.log(`[seed] Creating ${fullName}...`);
  const tx = await wrapper.getFunction("setSubnodeRecord")(
    parentNode,
    label,
    ownerAddress,
    resolverAddress,
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

async function setBaseAddr(
  resolver: ethers.Contract,
  node: string,
  address: string,
  network: EnsNetwork,
): Promise<void> {
  const encoded = encodeAddrBytes(address);
  const coinType = network === "mainnet" ? COIN_TYPE.baseMainnet : COIN_TYPE.baseSepolia;
  const label = network === "mainnet" ? "base-mainnet" : "base-sepolia";
  const tx = await resolver.getFunction("setAddr(bytes32,uint256,bytes)")(
    node,
    coinType,
    encoded,
  );
  await tx.wait();
  console.log(`  addr[${label}] = ${address}`);
}

async function main(): Promise<void> {
  const network = parseNetworkFlag();
  const parentName = parseNameFlag(network);

  const signer = getEnsSigner(network);
  const contracts = getEnsContracts(network);
  const signerAddress = await signer.getAddress();

  console.log(`[seed] Network: ${network} (chainId ${contracts.chainId})`);
  console.log(`[seed] Signer:  ${signerAddress}`);
  console.log(`[seed] Parent:  ${parentName}`);

  const parentExists = await isNameRegistered(parentName, network);
  if (!parentExists) {
    throw new Error(
      `${parentName} is not registered on ${network}. Register it first: tsx scripts/ens/register-parent.ts --network=${network}`,
    );
  }

  const parentNode = ethers.namehash(parentName);
  const wrapper = new ethers.Contract(contracts.nameWrapper, NAME_WRAPPER_ABI, signer);
  const resolver = new ethers.Contract(contracts.publicResolver, ENS_RESOLVER_ABI, signer);

  // 1. agent subname + records
  const agentNode = await ensureSubnameExists(
    wrapper,
    contracts.publicResolver,
    parentNode,
    parentName,
    AGENT_LABEL,
    signerAddress,
    network,
  );
  console.log(`[seed] Setting records on ${AGENT_LABEL}.${parentName}...`);
  await setText(resolver, agentNode, RECORD_KEYS.description, "Vigil, autonomous proxy upgrade auditor");
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

  // 2. demo subname + records, reads demo-target/deployments/<slug>.json.
  //    Skips with a friendly message if there is no deploy file for this network yet.
  const slug = network === "mainnet" ? "base-mainnet" : "base-sepolia";
  const deployPath = demoDeploymentPath(slug);
  let deployExists = true;
  try {
    await fs.access(deployPath);
  } catch {
    deployExists = false;
  }

  if (deployExists) {
    const demoProxy = await readDemoProxy(deployPath);
    console.log(`[seed] Demo proxy on ${slug}: ${demoProxy}`);
    const demoNode = await ensureSubnameExists(
      wrapper,
      contracts.publicResolver,
      parentNode,
      parentName,
      DEMO_LABEL,
      signerAddress,
      network,
    );
    console.log(`[seed] Setting records on ${DEMO_LABEL}.${parentName}...`);
    await setText(resolver, demoNode, RECORD_KEYS.description, "Vigil demo proxy, live-upgraded during the pitch");
    await setText(resolver, demoNode, RECORD_KEYS.kind, "demo-proxy");
    await setBaseAddr(resolver, demoNode, demoProxy, network);

    // 3. write the address-to-name cache for the agent's fast tagging path
    const cache: EnsTargetCache = {
      [demoProxy.toLowerCase()]: `${DEMO_LABEL}.${parentName}`,
    };
    await saveEnsCache(cache);
    console.log(`[seed] Wrote data/ens-targets.json with ${Object.keys(cache).length} entry`);
  } else {
    console.log(
      `[seed] Skipping demo.${parentName}, ${deployPath} does not exist yet. Deploy first, then re-run.`,
    );
  }

  const explorerNet = network === "mainnet" ? "mainnet" : "sepolia";
  console.log("\n[seed] Done. Next:");
  console.log(`  - Verify on https://app.ens.domains/${AGENT_LABEL}.${parentName}?network=${explorerNet}`);
  if (network === "sepolia") {
    console.log(`  - Set ENSIP-19 reverse name on Base Sepolia: tsx scripts/ens/set-base-primary.ts`);
  }
}

main().catch((err) => {
  console.error("[seed] Fatal:", err);
  process.exit(1);
});
