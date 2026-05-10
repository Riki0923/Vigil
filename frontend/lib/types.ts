export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AnalysisConfidence = "low" | "medium" | "high";

export type AnalysisResult = {
  summary: string;
  explanation: string;
  recommendation: string;
  confidence: AnalysisConfidence;
};

export type StorageLayoutEntry = {
  astId?: number;
  contract?: string;
  label: string;
  offset: number;
  slot: string;
  type: string;
};

export type MovedVariable = {
  label: string;
  oldSlot: string;
  newSlot: string;
  oldOffset: number;
  newOffset: number;
};

export type DiffResult = {
  removedVariables: StorageLayoutEntry[];
  addedVariables: StorageLayoutEntry[];
  movedVariables: MovedVariable[];
};

export type ABIParam = {
  name: string;
  type: string;
  components?: ABIParam[];
};

export type ABIItem = {
  type: string;
  name?: string;
  inputs?: ABIParam[];
  outputs?: ABIParam[];
  stateMutability?: string;
};

export type ModifiedFunction = {
  name: string;
  old: ABIItem;
  new: ABIItem;
};

export type ABIDiff = {
  addedFunctions: ABIItem[];
  removedFunctions: ABIItem[];
  modifiedFunctions: ModifiedFunction[];
};

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM";

export type RiskFlag = {
  level: RiskLevel;
  message: string;
};

export type MatchType = string | null;

export function isExactMatch(m: MatchType): boolean {
  return typeof m === "string" && m.toLowerCase().includes("exact");
}

export function isPartialMatch(m: MatchType): boolean {
  return typeof m === "string" && m.toLowerCase().includes("partial");
}

export type ContractMeta = {
  matchType: MatchType;
  creationTxHash: string | null;
  compilerVersion: string | null;
};

export type NatSpecMethod = {
  notice?: string;
  details?: string;
};

export type NatSpec = {
  title: string | null;
  notice: string | null;
  details: string | null;
  methods: Record<string, NatSpecMethod>;
};

export type SimilarContract = {
  address: string;
  chainId: number;
  similarity: number;
};

export type ApifyEnrichment = {
  twitterMentions: { text?: string; url?: string }[];
  newsResults: { title?: string; url?: string; organicResults?: { title?: string; url?: string }[] }[];
  enrichedAt: string;
};

export type FullPipelineRawData = {
  storageDiff: DiffResult | null;
  abiDiff: ABIDiff | null;
  functionRiskFlags: RiskFlag[];
  matchType: MatchType;
  contractMeta: ContractMeta | null;
  natSpec: NatSpec | null;
  apifyEnrichment?: ApifyEnrichment;
};

export type UnverifiedRawData = {
  oldImplAddress: string;
  similarContracts: SimilarContract[];
};

export type Alert = {
  id: string;
  timestamp: string;
  severity: AlertSeverity;
  proxyAddress: string;
  proxyName?: string;
  implementationAddress: string;
  txHash: string;
  blockNumber?: number;
  chainId?: number;
  isVerified: boolean;
  hasStorageLayout: boolean;
  message: string;
  rawData: unknown;
  swarmUrl?: string;
  analysis?: AnalysisResult;
};

export function getSwarmUrl(alert: Alert): string | undefined {
  if (alert.swarmUrl) return alert.swarmUrl;
  if (alert.rawData && typeof alert.rawData === "object") {
    const url = (alert.rawData as Record<string, unknown>).swarmUrl;
    if (typeof url === "string") return url;
  }
  return undefined;
}

export function isFullPipelineRawData(raw: unknown): raw is FullPipelineRawData {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return "storageDiff" in r && "abiDiff" in r && "functionRiskFlags" in r;
}

export function isUnverifiedRawData(raw: unknown): raw is UnverifiedRawData {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return "similarContracts" in r && Array.isArray(r.similarContracts);
}

export function isDiffResult(raw: unknown): raw is DiffResult {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    Array.isArray(r.removedVariables) &&
    Array.isArray(r.addedVariables) &&
    Array.isArray(r.movedVariables)
  );
}

export function abiSignature(item: ABIItem): string {
  const params = (item.inputs ?? []).map((p) => p.type).join(",");
  return `${item.name ?? item.type}(${params})`;
}
