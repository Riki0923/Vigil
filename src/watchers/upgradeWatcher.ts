import { ethers } from "ethers";

const UPGRADED_TOPIC = "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";
const UPGRADED_IFACE = new ethers.Interface([
  "event Upgraded(address indexed implementation)",
]);

export type UpgradeCallback = (
  txHash: string,
  proxyAddress: string,
  implAddress: string
) => Promise<void>;

export async function startUpgradeWatcher(
  provider: ethers.JsonRpcProvider,
  onUpgrade: UpgradeCallback
): Promise<void> {
  provider.on("block", async (blockNumber: number) => {
    try {
      const logs = await provider.getLogs({
        fromBlock: blockNumber,
        toBlock: blockNumber,
        topics: [UPGRADED_TOPIC],
      });

      for (const log of logs) {
        const parsed = UPGRADED_IFACE.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed) continue;

        const proxyAddress = log.address;
        const implAddress = parsed.args[0] as string;
        const txHash = log.transactionHash;

        console.log(`[UpgradeWatcher] Upgrade detected at block ${blockNumber}`);
        console.log(`  Proxy:          ${proxyAddress}`);
        console.log(`  Implementation: ${implAddress}`);
        console.log(`  Tx:             ${txHash}`);

        await onUpgrade(txHash, proxyAddress, implAddress);
      }
    } catch (err) {
      console.error(`[UpgradeWatcher] Error scanning block ${blockNumber}:`, err);
    }
  });

  console.log("[UpgradeWatcher] Listening for EIP-1967 Upgraded events...");
}
