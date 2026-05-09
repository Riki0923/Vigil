// Pre-flight check before registering vigil.eth on Ethereum Sepolia.
// Reports: wallet address, Sepolia ETH balance, name availability, registration price.
//
// Usage: tsx scripts/ens/check-parent.ts

import * as dotenv from "dotenv";
import { ethers } from "ethers";

import { ENS_SEPOLIA, getSepoliaProvider, getSepoliaSigner } from "../../src/ens/index.js";

dotenv.config();

const PARENT_NAME = process.env.VIGIL_PARENT_ENS_NAME ?? "vigil.eth";
const LABEL = PARENT_NAME.replace(/\.eth$/, "");
const REGISTRATION_DURATION_SECS = 31_557_600; // 365.25 days

const CONTROLLER_ABI = [
  "function available(string name) view returns (bool)",
  "function rentPrice(string name, uint256 duration) view returns (tuple(uint256 base, uint256 premium))",
] as const;

async function main(): Promise<void> {
  const provider = getSepoliaProvider();
  const signer = getSepoliaSigner();
  const address = await signer.getAddress();

  const [balance, network] = await Promise.all([
    provider.getBalance(address),
    provider.getNetwork(),
  ]);

  console.log(`[check] Network:    ${network.name} (chainId ${network.chainId})`);
  console.log(`[check] Wallet:     ${address}`);
  console.log(`[check] Balance:    ${ethers.formatEther(balance)} ETH (Sepolia)`);

  const controller = new ethers.Contract(
    ENS_SEPOLIA.ethRegistrarController,
    CONTROLLER_ABI,
    provider,
  );

  const available = (await controller.getFunction("available")(LABEL)) as boolean;
  console.log(`[check] ${PARENT_NAME} available: ${available ? "YES" : "NO (already registered)"}`);

  if (!available) {
    console.log(`[check] Pick a different name (set VIGIL_PARENT_ENS_NAME) or use the registered one as-is.`);
    return;
  }

  const price = (await controller.getFunction("rentPrice")(LABEL, REGISTRATION_DURATION_SECS)) as {
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
    console.log(`[check] Fund this address with Sepolia ETH from a faucet:`);
    console.log(`         https://sepoliafaucet.com  (Alchemy)`);
    console.log(`         https://www.infura.io/faucet/sepolia`);
    console.log(`         https://faucet.quicknode.com/ethereum/sepolia`);
    return;
  }

  console.log(`[check] ✅ Ready to register. Run: tsx scripts/ens/register-parent.ts`);
}

main().catch((err) => {
  console.error("[check] Fatal:", err);
  process.exit(1);
});
