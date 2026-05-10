import axios from "axios";
import { ethers } from "ethers";

const BASE_URL = "https://sourcify.dev/server";

interface CheckByAddressResult {
  address: string;
  status: string;
  chainIds?: string[];
}

interface NatSpecMethod {
  notice?: string;
  details?: string;
}

interface SourcifyV2Response {
  match: "exact" | "partial" | null;
  compilationArtifacts?: {
    abi?: unknown[];
    storageLayout?: StorageLayout;
    devdoc?: {
      title?: string;
      notice?: string;
      details?: string;
      methods?: Record<string, NatSpecMethod>;
    };
    userdoc?: {
      notice?: string;
      methods?: Record<string, { notice?: string }>;
    };
  };
  onchainInfo?: {
    creationTransactionHash?: string;
  };
  compilation?: {
    compilerVersion?: string;
  };
}

interface SimilarContract {
  address: string;
  chainId: number;
  similarity: number;
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

export interface NatSpec {
  title: string | null;
  notice: string | null;
  details: string | null;
  methods: Record<string, NatSpecMethod>;
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
      `[Sourcify] ${address}, ${verified ? "verified ✓" : "not verified ✗"} (status: ${result?.status ?? "unknown"})`
    );

    return verified;
  } catch (err) {
    console.error(`[Sourcify] isVerified failed for ${address}:`, err);
    return false;
  }
}

export async function isVerifiedWithRetry(
  address: string,
  chainId: number,
  maxRetries: number = 3,
  delayMs: number = 60_000
): Promise<boolean> {
  if (await isVerified(address, chainId)) return true;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[Sourcify] Contract not yet verified, retrying in ${delayMs / 1000}s (attempt ${attempt}/${maxRetries})...`
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (await isVerified(address, chainId)) return true;
  }

  console.log(`[Sourcify] Verification not found after ${maxRetries} retries for ${address}`);
  return false;
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

export async function getNatSpec(
  address: string,
  chainId: number
): Promise<NatSpec | null> {
  const data = await fetchV2(address, chainId);
  if (!data) return null;

  const { devdoc, userdoc } = data.compilationArtifacts ?? {};
  if (!devdoc && !userdoc) {
    console.log(`[Sourcify] No NatSpec found for ${address}`);
    return null;
  }

  const methods: Record<string, NatSpecMethod> = {};

  for (const [sig, doc] of Object.entries(devdoc?.methods ?? {})) {
    methods[sig] = {
      ...(doc.notice !== undefined && { notice: doc.notice }),
      ...(doc.details !== undefined && { details: doc.details }),
    };
  }

  for (const [sig, doc] of Object.entries(userdoc?.methods ?? {})) {
    if (!methods[sig]) methods[sig] = {};
    if (doc.notice !== undefined) methods[sig]!.notice ??= doc.notice;
  }

  const natspec: NatSpec = {
    title: devdoc?.title ?? null,
    notice: devdoc?.notice ?? userdoc?.notice ?? null,
    details: devdoc?.details ?? null,
    methods,
  };

  console.log(
    `[Sourcify] NatSpec for ${address}: found (${Object.keys(methods).length} method(s) documented)`
  );

  return natspec;
}

export async function findSimilarContracts(
  address: string,
  chainId: number,
  provider: ethers.JsonRpcProvider
): Promise<SimilarContract[]> {
  try {
    const bytecode = await provider.getCode(address);

    if (!bytecode || bytecode === "0x") {
      console.log(`[Sourcify] No bytecode found for ${address}, not a contract?`);
      return [];
    }

    const { data } = await axios.post<{ results?: SimilarContract[] }>(
      `${BASE_URL}/v2/verify/similarity`,
      { bytecode, chainId }
    );

    const results = data.results ?? [];

    console.log(
      `[Sourcify] Similarity search for ${address}: ${results.length} similar contract(s) found`
    );

    return results;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      console.log(`[Sourcify] No similar contracts found for ${address}`);
      return [];
    }
    console.error(`[Sourcify] findSimilarContracts failed for ${address}:`, err);
    return [];
  }
}
