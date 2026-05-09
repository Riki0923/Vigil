// Pre-flight check before registering the parent ENS name.
// Reports: wallet address, balance, name availability, registration price.
//
// Usage:
//   tsx scripts/ens/check-parent.ts                              (defaults: sepolia, vigil.eth)
//   tsx scripts/ens/check-parent.ts --network=mainnet            (defaults to vigilbot.eth)
//   tsx scripts/ens/check-parent.ts --network=mainnet --name=foo.eth

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

const CONTROLLER_ABI = [
  "function available(string name) view returns (bool)",
  "function rentPrice(string name, uint256 duration) view returns (tuple(uint256 base, uint256 premium))",
] as const;

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
  const address = await signer.getAddress();

  const [balance, net] = await Promise.all([provider.getBalance(address), provider.getNetwork()]);

  console.log(`[check] Network:    ${network} (chainId ${net.chainId})`);
  console.log(`[check] Wallet:     ${address}`);
  console.log(`[check] Balance:    ${ethers.formatEther(balance)} ETH`);
  console.log(`[check] Name:       ${parentName}`);

  const controller = new ethers.Contract(
    contracts.ethRegistrarController,
    CONTROLLER_ABI,
    provider,
  );

  const available = (await controller.getFunction("available")(label)) as boolean;
  console.log(`[check] ${parentName} available: ${available ? "YES" : "NO (already registered)"}`);

  if (!available) {
    console.log(`[check] Pick a different name (--name=foo.eth) or use the registered one as-is.`);
    return;
  }

  const price = (await controller.getFunction("rentPrice")(label, REGISTRATION_DURATION_SECS)) as {
    base: bigint;
    premium: bigint;
  };
  const total = price.base + price.premium;
  console.log(
    `[check] Rent price (1 year): base=${ethers.formatEther(price.base)} premium=${ethers.formatEther(price.premium)} total=${ethers.formatEther(total)} ETH`,
  );

  const headroom = (total * 110n) / 100n; // +10% buffer for gas + price drift
  if (balance < headroom) {
    console.log(
      `[check] ⚠ Wallet has less than the registration cost + 10% gas headroom (${ethers.formatEther(headroom)} ETH).`,
    );
    if (network === "sepolia") {
      console.log(`[check] Fund this address with Sepolia ETH from a faucet:`);
      console.log(`         https://sepoliafaucet.com  (Alchemy)`);
      console.log(`         https://www.infura.io/faucet/sepolia`);
    } else {
      console.log(`[check] Fund this address with mainnet ETH before registering.`);
    }
    return;
  }

  console.log(
    `[check] ✅ Ready to register. Run: tsx scripts/ens/register-parent.ts --network=${network}${network === "mainnet" ? ` --name=${parentName}` : ""}`,
  );
}

main().catch((err) => {
  console.error("[check] Fatal:", err);
  process.exit(1);
});
