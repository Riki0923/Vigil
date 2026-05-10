// Registers the parent ENS name (vigil.eth on Sepolia, vigilbot.eth on mainnet)
// via the ETHRegistrarController. Uses commit-reveal: commit → wait
// MIN_COMMITMENT_AGE (60s) → register. The register call wraps the name in
// NameWrapper as part of the same tx.
//
// Prerequisites: ENS_REGISTRAR_PRIVATE_KEY funded with ETH > registration + gas.
//   Sepolia: SEPOLIA_RPC_URL
//   Mainnet: MAINNET_RPC_URL
//
// Usage:
//   tsx scripts/ens/register-parent.ts                              (sepolia, vigil.eth)
//   tsx scripts/ens/register-parent.ts --network=mainnet            (mainnet, vigilbot.eth)
//   tsx scripts/ens/register-parent.ts --network=mainnet --name=foo.eth

import * as dotenv from "dotenv";
import { ethers } from "ethers";

import {
  getEnsContracts,
  getEnsProvider,
  getEnsSigner,
  type EnsNetwork,
} from "../../src/ens/index.js";

dotenv.config();

const REGISTRATION_DURATION_SECS = 31_557_600; // 365.25 days
const COMMITMENT_WAIT_BUFFER_SECS = 30; // wait minCommitmentAge + this much
const FUSES = 0;
const REVERSE_RECORD = false;

const CONTROLLER_ABI = [
  "function available(string name) view returns (bool)",
  "function rentPrice(string name, uint256 duration) view returns (tuple(uint256 base, uint256 premium))",
  "function makeCommitment(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) payable",
  "function minCommitmentAge() view returns (uint256)",
  "function commitments(bytes32) view returns (uint256)",
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function main(): Promise<void> {
  const network = parseNetworkFlag();
  const parentName = parseNameFlag(network);
  const label = parentName.replace(/\.eth$/, "");

  const provider = getEnsProvider(network);
  const signer = getEnsSigner(network);
  const contracts = getEnsContracts(network);
  const owner = await signer.getAddress();

  const controller = new ethers.Contract(
    contracts.ethRegistrarController,
    CONTROLLER_ABI,
    signer,
  );
  const controllerView = controller.connect(provider);

  console.log(`[register] Network:  ${network} (chainId ${contracts.chainId})`);
  console.log(`[register] Owner:    ${owner}`);
  console.log(`[register] Name:     ${parentName}`);
  console.log(`[register] Duration: ${REGISTRATION_DURATION_SECS}s (~365 days)`);

  const available = (await controllerView.getFunction("available")(label)) as boolean;
  if (!available) {
    throw new Error(`${parentName} is no longer available. Aborting.`);
  }

  const price = (await controllerView.getFunction("rentPrice")(
    label,
    REGISTRATION_DURATION_SECS,
  )) as { base: bigint; premium: bigint };
  const total = price.base + price.premium;
  const valueWithBuffer = (total * 105n) / 100n; // +5% slippage buffer
  console.log(
    `[register] Cost:     ${ethers.formatEther(total)} ETH (sending ${ethers.formatEther(valueWithBuffer)} ETH)`,
  );

  const balance = await provider.getBalance(owner);
  if (balance < valueWithBuffer) {
    throw new Error(
      `Insufficient balance. Have ${ethers.formatEther(balance)} ETH, need at least ${ethers.formatEther(valueWithBuffer)} ETH (+ gas).`,
    );
  }

  // Step 1: commitment
  const secret = ethers.hexlify(ethers.randomBytes(32));
  console.log(`[register] Secret:   ${secret}`);

  const commitment = (await controllerView.getFunction("makeCommitment")(
    label,
    owner,
    REGISTRATION_DURATION_SECS,
    secret,
    contracts.publicResolver,
    [], // no initial records (we'll add them via the seed script)
    REVERSE_RECORD,
    FUSES,
  )) as string;
  console.log(`[register] Commitment: ${commitment}`);

  const minAgeBig = (await controllerView.getFunction("minCommitmentAge")()) as bigint;
  const minAge = Number(minAgeBig);
  console.log(`[register] minCommitmentAge: ${minAge}s`);

  console.log(`[register] Submitting commit tx...`);
  const commitTx = await controller.getFunction("commit")(commitment);
  console.log(`[register] Commit tx: ${commitTx.hash}`);
  await commitTx.wait();
  console.log(`[register] Commit confirmed.`);

  // Poll the on-chain commitment age, wall-clock can drift from chain time on
  // slow/sparse blocks. Wait until block.timestamp - commit_ts >= minCommitmentAge + buffer.
  console.log(
    `[register] Waiting for commit to mature on-chain (minAge ${minAge}s + ${COMMITMENT_WAIT_BUFFER_SECS}s buffer)...`,
  );
  while (true) {
    const [latest, commitTs] = await Promise.all([
      provider.getBlock("latest"),
      controllerView.getFunction("commitments")(commitment) as Promise<bigint>,
    ]);
    if (!latest) {
      await sleep(3_000);
      continue;
    }
    const age = latest.timestamp - Number(commitTs);
    process.stdout.write(`  on-chain commit age: ${age}s    \r`);
    if (age >= minAge + COMMITMENT_WAIT_BUFFER_SECS) {
      console.log("");
      break;
    }
    await sleep(3_000);
  }

  // Step 2: register
  console.log(`[register] Submitting register tx (value=${ethers.formatEther(valueWithBuffer)} ETH)...`);
  const registerTx = await controller.getFunction("register")(
    label,
    owner,
    REGISTRATION_DURATION_SECS,
    secret,
    contracts.publicResolver,
    [],
    REVERSE_RECORD,
    FUSES,
    { value: valueWithBuffer },
  );
  console.log(`[register] Register tx: ${registerTx.hash}`);
  const receipt = await registerTx.wait();
  console.log(`[register] Confirmed in block ${receipt?.blockNumber}.`);

  console.log(`\n[register] ✅ ${parentName} registered + wrapped to ${owner}`);
  const explorerNet = network === "mainnet" ? "mainnet" : "sepolia";
  console.log(`[register] Verify: https://app.ens.domains/${parentName}?network=${explorerNet}`);
  console.log(
    `[register] Next:   tsx scripts/ens/seed-subnames.ts --network=${network}${network === "mainnet" ? ` --name=${parentName}` : ""}`,
  );
}

main().catch((err) => {
  console.error("[register] Fatal:", err);
  process.exit(1);
});
