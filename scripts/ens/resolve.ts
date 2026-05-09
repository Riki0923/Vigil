// Debug helper: resolves an ENS name and prints all known records.
// Network defaults to whatever VIGIL_ENS_NETWORK selects (mainnet by default);
// override with --network=mainnet|sepolia.
//
// Usage:
//   tsx scripts/ens/resolve.ts agent.vigilbot.eth
//   tsx scripts/ens/resolve.ts agent.vigil.eth --network=sepolia
//   tsx scripts/ens/resolve.ts demo.vigilbot.eth --network=mainnet

// Resolve --network=… BEFORE importing src/ens, since getActiveNetwork() reads
// process.env.VIGIL_ENS_NETWORK at module load time.
const networkFlag = process.argv.find((a) => a.startsWith("--network="));
if (networkFlag) {
  const value = networkFlag.slice("--network=".length);
  if (value !== "mainnet" && value !== "sepolia") {
    console.error(`--network must be "mainnet" or "sepolia" (got "${value}")`);
    process.exit(1);
  }
  process.env.VIGIL_ENS_NETWORK = value;
}

import * as dotenv from "dotenv";
import { resolveAgentConfig, resolveTargetConfig } from "../../src/ens/index.js";

dotenv.config();

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const name = positional[0];
  if (!name) {
    console.error("Usage: tsx scripts/ens/resolve.ts <name> [--network=mainnet|sepolia]");
    process.exit(1);
  }

  const network = process.env.VIGIL_ENS_NETWORK ?? "sepolia";
  const networkLabel = network === "mainnet" ? "Ethereum Mainnet" : "Ethereum Sepolia";
  console.log(`[resolve] Resolving ${name} on ${networkLabel}...`);

  const [agent, target] = await Promise.all([
    resolveAgentConfig(name),
    resolveTargetConfig(name),
  ]);

  if (!agent && !target) {
    console.log(`[resolve] No resolver / records found for ${name}`);
    return;
  }

  console.log("\nAgent-shaped records:");
  console.log(JSON.stringify(agent, null, 2));
  console.log("\nTarget-shaped records:");
  console.log(JSON.stringify(target, null, 2));
}

main().catch((err) => {
  console.error("[resolve] Fatal:", err);
  process.exit(1);
});
