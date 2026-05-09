// Debug helper: resolves an ENS name on Sepolia and prints all known records.
//
// Usage:
//   tsx scripts/ens/resolve.ts agent.vigil.eth
//   tsx scripts/ens/resolve.ts demo.vigil.eth

import * as dotenv from "dotenv";
import { resolveAgentConfig, resolveTargetConfig } from "../../src/ens/index.js";

dotenv.config();

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: tsx scripts/ens/resolve.ts <name>");
    process.exit(1);
  }

  console.log(`[resolve] Resolving ${name} on Ethereum Sepolia...`);

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
