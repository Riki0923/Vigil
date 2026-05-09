import { ethers } from "ethers";
import { logAlert, type Alert } from "../alerts/index.js";
import { appendAlert } from "./jsonStore.js";

let cachedProvider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider | null {
  if (cachedProvider) return cachedProvider;
  const url = process.env.BASE_MAINNET_RPC_URL;
  if (!url) return null;
  cachedProvider = new ethers.JsonRpcProvider(url);
  return cachedProvider;
}

async function lookupBlockNumber(txHash: string): Promise<number | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    return receipt?.blockNumber ?? null;
  } catch (err) {
    console.warn(`[emit] blockNumber lookup failed for ${txHash}:`, err);
    return null;
  }
}

export async function emitAlert(alert: Alert, blockNumber?: number): Promise<void> {
  logAlert(alert);
  const block =
    typeof blockNumber === "number" ? blockNumber : await lookupBlockNumber(alert.txHash);
  const enriched =
    typeof block === "number"
      ? ({ ...alert, blockNumber: block } as Alert & { blockNumber: number })
      : alert;
  await appendAlert(enriched);
}
