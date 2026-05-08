import axios from "axios";

const BASE_URL = "https://sourcify.dev/server";
export const BASE_SEPOLIA_CHAIN_ID = 8453;

interface CheckByAddressResult {
  address: string;
  status: string;
  chainIds?: string[];
}

interface SourcifyV2Response {
  match: "exact" | "partial" | null;
  compilationArtifacts?: {
    abi?: unknown[];
    storageLayout?: StorageLayout;
  };
  onchainInfo?: {
    creationTransactionHash?: string;
  };
  compilation?: {
    compilerVersion?: string;
  };
}

export interface StorageLayoutEntry {
  astId: number;
  contract: string;
  label: string;
  offset: number;
  slot: string;
  type: string;
}

export interface StorageLayout {
  storage: StorageLayoutEntry[];
  types: Record<string, unknown>;
}

export interface ContractMeta {
  matchType: "exact" | "partial" | null;
  creationTxHash: string | null;
  compilerVersion: string | null;
}

async function fetchV2(address: string, chainId: number): Promise<SourcifyV2Response | null> {
  try {
    const { data } = await axios.get<SourcifyV2Response>(
      `${BASE_URL}/v2/contract/${chainId}/${address}`,
      { params: { fields: "all" } }
    );
    return data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      console.log(`[Sourcify] Contract not found for ${address}`);
      return null;
    }
    console.error(`[Sourcify] v2 fetch failed for ${address}:`, err);
    return null;
  }
}

export async function isVerified(
  address: string,
  chainId: number
): Promise<boolean> {
  try {
    const { data } = await axios.get<CheckByAddressResult[]>(
      `${BASE_URL}/check-by-addresses`,
      { params: { addresses: address, chainIds: chainId } }
    );

    const result = data[0];
    const verified = result?.status === "perfect" || result?.status === "partial";

    console.log(
      `[Sourcify] ${address} — ${verified ? "verified ✓" : "not verified ✗"} (status: ${result?.status ?? "unknown"})`
    );

    return verified;
  } catch (err) {
    console.error(`[Sourcify] isVerified failed for ${address}:`, err);
    return false;
  }
}

export async function getStorageLayout(
  address: string,
  chainId: number
): Promise<StorageLayout | null> {
  const data = await fetchV2(address, chainId);
  if (!data) return null;

  const layout = data.compilationArtifacts?.storageLayout ?? null;

  console.log(
    `[Sourcify] Storage layout for ${address}: ${layout ? `found (${layout.storage.length} slot(s))` : "not found"}`
  );

  return layout;
}

export async function getABI(
  address: string,
  chainId: number
): Promise<unknown[] | null> {
  const data = await fetchV2(address, chainId);
  if (!data) return null;

  const abi = data.compilationArtifacts?.abi ?? null;

  console.log(
    `[Sourcify] ABI for ${address}: ${abi ? `found (${abi.length} item(s))` : "not found"}`
  );

  return abi;
}

export async function getContractMeta(
  address: string,
  chainId: number
): Promise<ContractMeta | null> {
  const data = await fetchV2(address, chainId);
  if (!data) return null;

  const meta: ContractMeta = {
    matchType: data.match ?? null,
    creationTxHash: data.onchainInfo?.creationTransactionHash ?? null,
    compilerVersion: data.compilation?.compilerVersion ?? null,
  };

  console.log(
    `[Sourcify] Meta for ${address}: match=${meta.matchType}, compiler=${meta.compilerVersion ?? "unknown"}`
  );

  return meta;
}
