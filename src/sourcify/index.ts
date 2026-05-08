import axios from "axios";

const BASE_URL = "https://sourcify.dev/server";
export const BASE_SEPOLIA_CHAIN_ID = 84532;

interface SourcifyFile {
  name: string;
  path: string;
  content: string;
}

interface SourcifyFilesResponse {
  files: SourcifyFile[];
}

interface CheckByAddressResult {
  address: string;
  status: string;
  chainIds?: string[];
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

export async function getContractSource(
  address: string,
  chainId: number
): Promise<SourcifyFile[] | null> {
  try {
    const { data } = await axios.get<SourcifyFilesResponse>(
      `${BASE_URL}/files/any/${chainId}/${address}`
    );

    console.log(
      `[Sourcify] Source found for ${address} — ${data.files.length} file(s)`
    );

    return data.files;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      console.log(`[Sourcify] Source not found for ${address}`);
      return null;
    }
    console.error(`[Sourcify] getContractSource failed for ${address}:`, err);
    return null;
  }
}

export async function getStorageLayout(
  address: string,
  chainId: number
): Promise<StorageLayout | null> {
  const files = await getContractSource(address, chainId);
  if (!files) return null;

  const metadataFile = files.find((f) => f.name === "metadata.json");
  if (!metadataFile) {
    console.log(`[Sourcify] No metadata.json found for ${address}`);
    return null;
  }

  try {
    const metadata = JSON.parse(metadataFile.content) as {
      output?: {
        contracts?: Record<
          string,
          Record<string, { storageLayout?: StorageLayout }>
        >;
      };
    };

    const contracts = metadata.output?.contracts;
    if (!contracts) {
      console.log(`[Sourcify] No compiler output in metadata for ${address}`);
      return null;
    }

    for (const fileContracts of Object.values(contracts)) {
      for (const contract of Object.values(fileContracts)) {
        if (contract.storageLayout) {
          console.log(`[Sourcify] Storage layout found for ${address}`);
          return contract.storageLayout;
        }
      }
    }

    console.log(`[Sourcify] Storage layout not present in metadata for ${address}`);
    return null;
  } catch (err) {
    console.error(`[Sourcify] Failed to parse metadata for ${address}:`, err);
    return null;
  }
}
