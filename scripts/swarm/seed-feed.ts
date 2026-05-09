// Publishes one bootstrap alert to the Swarm feed so the
// `vigil.feed` URL resolves immediately for subscribers / judges,
// even before the agent has detected a real upgrade.
//
// Uses SWARM_PRIVATE_KEY from .env. Idempotent — running it again just
// adds another bootstrap alert under a fresh id.
//
// Usage: tsx scripts/swarm/seed-feed.ts

import * as dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { initSwarm, publishAlert } from "../../src/swarm/index.js";

dotenv.config();

async function main(): Promise<void> {
  if (!process.env.SWARM_PRIVATE_KEY) {
    throw new Error("SWARM_PRIVATE_KEY is not set — pin it in .env first");
  }

  await initSwarm();

  const alert = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    severity: "INFO",
    proxyAddress: "0x0000000000000000000000000000000000000000",
    proxyName: "agent.vigil.eth",
    implementationAddress: "0x0000000000000000000000000000000000000000",
    txHash: "0x" + "0".repeat(64),
    isVerified: true,
    hasStorageLayout: false,
    message: "Vigil online — feed bootstrap (no real upgrade yet, this is the discovery payload)",
    rawData: {
      kind: "bootstrap",
      published_by: "scripts/swarm/seed-feed.ts",
    },
  };

  console.log(`[seed-feed] Publishing bootstrap alert id=${alert.id}...`);
  const url = await publishAlert(alert);
  if (!url) {
    throw new Error("publishAlert returned null — check Swarm gateway / postage");
  }
  console.log(`[seed-feed] ✅ Feed populated. Subscribers can now resolve vigil.feed.`);
  console.log(`[seed-feed]    Alert URL: ${url}`);
}

main().catch((err) => {
  console.error("[seed-feed] Fatal:", err.message ?? err);
  process.exit(1);
});
