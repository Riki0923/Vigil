// Backfill a contiguous range of Ethereum blocks from any JSON-RPC endpoint
// into a Swarm chain-archive manifest. Standalone PoC for the
// "Ethereum Chain State on Swarm" pattern — block-archive option.
//
// Usage:
//   tsx scripts/chain-archive/backfill.ts --from <n> --to <n> [--rpc <url>]
//                                         [--topic <name>]
//
// Required env: SWARM_PRIVATE_KEY (32-byte hex). Defaults RPC to RPC_URL.
// On completion prints the subscriber-facing feed URL — anyone resolving it
// gets the latest manifest with every archived block under blocks/<n>.

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { Bee, PrivateKey, Topic } from "@ethersphere/bee-js";
import { ChainArchive } from "../../src/libs/chain-archive/index.js";

dotenv.config();

const BZZ_LIMO = "https://bzz.limo";

interface CliArgs {
  from: number;
  to: number;
  rpc: string;
  topic?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === undefined) continue;
    if (k.startsWith("--")) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        throw new Error(`Missing value for ${k}`);
      }
      args[k.slice(2)] = v;
      i++;
    }
  }

  const from = args.from ? parseInt(args.from, 10) : NaN;
  const to = args.to ? parseInt(args.to, 10) : NaN;
  const rpc = args.rpc ?? process.env.RPC_URL ?? "";

  if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
    throw new Error("Pass --from <n> --to <n> with from <= to");
  }
  if (!rpc) {
    throw new Error("Pass --rpc <url> or set RPC_URL in .env");
  }

  return { from, to, rpc, ...(args.topic ? { topic: args.topic } : {}) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const rawKey = process.env.SWARM_PRIVATE_KEY;
  if (!rawKey) {
    throw new Error("SWARM_PRIVATE_KEY is not set — pin a 32-byte hex key in .env");
  }

  const privateKey = new PrivateKey(Buffer.from(rawKey.replace(/^0x/, ""), "hex"));
  const provider = new ethers.JsonRpcProvider(args.rpc);
  const archive = new ChainArchive({
    bee: new Bee(BZZ_LIMO),
    privateKey,
    ...(args.topic ? { topic: Topic.fromString(args.topic) } : {}),
  });

  await archive.init();
  console.log(`[backfill] Feed URL: ${archive.getFeedUrl()}`);

  const already = new Set(archive.listBlocks());
  if (already.size > 0) {
    console.log(`[backfill] Skipping ${already.size} block(s) already archived`);
  }

  let archived = 0;
  let skipped = 0;
  for (let n = args.from; n <= args.to; n++) {
    if (already.has(n)) {
      skipped++;
      continue;
    }

    const block = await provider.getBlock(n);
    if (!block) {
      console.warn(`[backfill] Block ${n} not available from RPC — skipping`);
      continue;
    }

    // ethers.Block.toJSON() returns a stable, JSON-serializable form
    const result = await archive.archiveBlock(n, block.toJSON());
    archived++;
    console.log(`[backfill] ${n} → ${result.reference.slice(0, 12)}…`);
  }

  console.log(`[backfill] Done. Archived ${archived} new block(s), skipped ${skipped}`);
  console.log(`[backfill] Feed URL: ${archive.getFeedUrl()}`);
  console.log(`[backfill] Latest manifest reference: ${archive.getManifestReference()}`);
}

main().catch((err) => {
  console.error(`[backfill] Fatal:`, err?.message ?? err);
  process.exit(1);
});
