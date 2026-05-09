"use client";

import { useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { DEMO_WALLET } from "./wallet";
import { makeLogger } from "./log";

const log = makeLogger("useRevokeApproval");

type Address = `0x${string}`;

const DEMO_WALLET_PRIVATE_KEY = process.env.NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY as
  | Address
  | undefined;

export function useDemoAllowance(
  chainId: number,
  token: Address | undefined,
  owner: Address | undefined,
  spender: Address | undefined,
) {
  return useReadContract({
    chainId,
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    query: {
      enabled: Boolean(token && owner && spender),
      refetchInterval: 5_000,
    },
  });
}

export function hasActiveApproval(allowance: bigint | undefined): boolean {
  return typeof allowance === "bigint" && allowance > 0n;
}

function chainForId(id: number) {
  if (id === base.id) return base;
  if (id === baseSepolia.id) return baseSepolia;
  return null;
}

export type RevokeState = "idle" | "sending" | "mining" | "mined" | "error";

export function useRevokeApproval(opts: {
  chainId: number;
  proxyAddress: Address | undefined;
  spender: Address | undefined;
  onSuccess?: () => void;
}) {
  const { chainId, proxyAddress, spender, onSuccess } = opts;
  const { address: connectedAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const wagmiPublicClient = usePublicClient({ chainId });

  const [state, setState] = useState<RevokeState>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | undefined>();

  const usingExternalWallet = isConnected && Boolean(connectedAddress);
  const ownerAddress: Address | undefined = usingExternalWallet
    ? (connectedAddress as Address)
    : (DEMO_WALLET as Address | undefined);

  const revoke = async () => {
    if (!proxyAddress || !spender) {
      setError("missing proxy or spender");
      setState("error");
      return;
    }
    log.start("click revoke", {
      chainId,
      proxy: proxyAddress,
      spender,
      owner: ownerAddress,
      usingExternalWallet,
    });
    setError(undefined);
    setTxHash(undefined);
    setState("sending");
    try {
      let hash: `0x${string}`;

      if (usingExternalWallet) {
        if (!wagmiPublicClient) {
          throw new Error(`No public client available for chain ${chainId}`);
        }
        log.sign(`signing as connected ${connectedAddress}`);
        hash = await writeContractAsync({
          chainId,
          address: proxyAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, 0n],
        });
        log.tx(`tx submitted: ${hash}`);
        setTxHash(hash);
        setState("mining");
        const receipt = await wagmiPublicClient.waitForTransactionReceipt({ hash });
        log.ok(
          `tx mined block=${receipt.blockNumber} status=${receipt.status}`,
        );
      } else {
        if (!DEMO_WALLET_PRIVATE_KEY) {
          throw new Error("NEXT_PUBLIC_DEMO_WALLET_PRIVATE_KEY not set");
        }
        const chain = chainForId(chainId);
        if (!chain) {
          throw new Error(`Unsupported chain: ${chainId}`);
        }
        const account = privateKeyToAccount(DEMO_WALLET_PRIVATE_KEY);
        log.sign(`signing as demo ${account.address} on ${chain.name}`);
        const walletClient = createWalletClient({ account, chain, transport: http() });
        const publicClient = createPublicClient({ chain, transport: http() });
        hash = await walletClient.writeContract({
          address: proxyAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, 0n],
        });
        log.tx(`tx submitted: ${hash}`);
        setTxHash(hash);
        setState("mining");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        log.ok(
          `tx mined block=${receipt.blockNumber} status=${receipt.status}`,
        );
      }

      setState("mined");
      onSuccess?.();
    } catch (err) {
      log.error("revoke failed", err);
      const msg = err instanceof Error ? err.message : "revoke failed";
      setError(msg);
      setState("error");
    }
  };

  return { state, txHash, error, revoke, ownerAddress, usingExternalWallet };
}
