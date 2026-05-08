import { ethers } from "ethers";

const UPGRADED_TOPIC = "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";
const UPGRADED_IFACE = new ethers.Interface([
  "event Upgraded(address indexed implementation)",
]);

// EIP-1967 implementation slot
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type UpgradeCallback = (
  txHash: string,
  proxyAddress: string,
  newImplAddress: string,
  oldImplAddress: string,
  block: ethers.Block
) => Promise<void>;

export async function startUpgradeWatcher(
  provider: ethers.JsonRpcProvider,
  onUpgrade: UpgradeCallback
): Promise<void> {
  provider.on("block", async (blockNumber: number) => {
    try {
      const [logs, block] = await Promise.all([
        provider.getLogs({
          fromBlock: blockNumber,
          toBlock: blockNumber,
          topics: [UPGRADED_TOPIC],
        }),
        provider.getBlock(blockNumber),
      ]);

      if (!block) {
        console.warn(`[UpgradeWatcher] Could not fetch block ${blockNumber}`);
        return;
      }

      for (const log of logs) {
        const parsed = UPGRADED_IFACE.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed) continue;

        const proxyAddress = log.address;
        const newImplAddress = parsed.args[0] as string;
        const txHash = log.transactionHash;

        // Read the implementation that was active before this block
        const raw = await provider.getStorage(proxyAddress, IMPL_SLOT, blockNumber - 1);
        const oldImplAddress = "0x" + raw.slice(-40);

        console.log(`[UpgradeWatcher] Upgrade detected at block ${blockNumber}`);
        console.log(`  Proxy:           ${proxyAddress}`);
        console.log(`  Old impl:        ${oldImplAddress}`);
        console.log(`  New impl:        ${newImplAddress}`);
        console.log(`  Tx:              ${txHash}`);

        await onUpgrade(txHash, proxyAddress, newImplAddress, oldImplAddress);
      }
    } catch (err) {
      console.error(`[UpgradeWatcher] Error scanning block ${blockNumber}:`, err);
    }
  });

  console.log("[UpgradeWatcher] Listening for EIP-1967 Upgraded events...");
}
