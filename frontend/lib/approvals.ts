"use client";

import { useReadContract } from "wagmi";
import { erc20Abi } from "viem";

type Address = `0x${string}`;

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
