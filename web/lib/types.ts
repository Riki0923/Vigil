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

export type Alert = {
  id: string;
  timestamp: string;
  severity: AlertSeverity;
  proxyAddress: string;
  implementationAddress: string;
  txHash: string;
  isVerified: boolean;
  hasStorageLayout: boolean;
  message: string;
  rawData: unknown;
  analysis?: AnalysisResult;
};

export function isDiffResult(raw: unknown): raw is DiffResult {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    Array.isArray(r.removedVariables) &&
    Array.isArray(r.addedVariables) &&
    Array.isArray(r.movedVariables)
  );
}
