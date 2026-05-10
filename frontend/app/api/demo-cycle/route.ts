import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { makeLogger } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

const log = makeLogger("api/demo-cycle");

type CycleResult = {
  upgradeTxHash: string;
  v2ImplAddress: string;
  proxyAddress: string;
  allowance: "unlimited";
  chainId: 8453;
};

type CycleState =
  | { status: "idle" }
  | { status: "running"; startedAt: string }
  | {
      status: "done";
      startedAt: string;
      completedAt: string;
      result: CycleResult;
    }
  | {
      status: "error";
      startedAt: string;
      completedAt: string;
      message: string;
      stderrTail?: string;
    };

let cycleState: CycleState = { status: "idle" };

const REPO_ROOT = path.resolve(process.cwd(), "..");
const DEMO_TARGET_DIR = path.join(REPO_ROOT, "demo-target");
const DEPLOYMENTS_PATH = path.join(DEMO_TARGET_DIR, "deployments", "base-mainnet.json");
const UPGRADE_TX_REGEX = /upgrade tx:\s*(0x[a-fA-F0-9]{64})/;

export async function POST(): Promise<Response> {
  if (cycleState.status === "running") {
    log.warn(`already running since ${cycleState.startedAt}`);
    return Response.json(cycleState, { status: 409 });
  }
  const startedAt = new Date().toISOString();
  cycleState = { status: "running", startedAt };
  void runCycle(startedAt);
  return Response.json(cycleState, { status: 202 });
}

export async function GET(): Promise<Response> {
  return Response.json(cycleState);
}

async function runCycle(startedAt: string): Promise<void> {
  log.start("spawning demo-cycle:mainnet…");

  let stdout = "";
  let stderr = "";

  try {
    const exitCode: number = await new Promise((resolve, reject) => {
      const child = spawn("npm", ["run", "demo-cycle:mainnet"], {
        cwd: DEMO_TARGET_DIR,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        process.stdout.write(text);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        process.stderr.write(text);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });

    if (exitCode !== 0) {
      finishWithError(startedAt, `demo-cycle exited with code ${exitCode}`, stderr);
      return;
    }

    const upgradeMatch = stdout.match(UPGRADE_TX_REGEX);
    if (!upgradeMatch) {
      finishWithError(
        startedAt,
        "could not parse upgrade tx hash from script output",
        stderr,
      );
      return;
    }
    const upgradeTxHash = upgradeMatch[1];

    const raw = await readFile(DEPLOYMENTS_PATH, "utf8");
    const record = JSON.parse(raw) as {
      proxyAddress: string;
      v2ImplAddress?: string;
    };
    if (!record.proxyAddress || !record.v2ImplAddress) {
      finishWithError(
        startedAt,
        "deployments JSON missing proxyAddress or v2ImplAddress",
        stderr,
      );
      return;
    }

    cycleState = {
      status: "done",
      startedAt,
      completedAt: new Date().toISOString(),
      result: {
        upgradeTxHash,
        v2ImplAddress: record.v2ImplAddress,
        proxyAddress: record.proxyAddress,
        allowance: "unlimited",
        chainId: 8453,
      },
    };
    log.ok(`cycle complete: tx=${upgradeTxHash} impl=${record.v2ImplAddress}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishWithError(startedAt, message, stderr);
  }
}

function finishWithError(startedAt: string, message: string, stderr: string): void {
  log.error(message);
  cycleState = {
    status: "error",
    startedAt,
    completedAt: new Date().toISOString(),
    message,
    stderrTail: stderr.slice(-2000) || undefined,
  };
}
