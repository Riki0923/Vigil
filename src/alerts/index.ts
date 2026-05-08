import { v4 as uuidv4 } from "uuid";
import type { AnalysisResult } from "../agent/analyser.js";

export enum AlertSeverity {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

export interface Alert {
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
}

type AlertInput = Omit<Alert, "id" | "timestamp">;

export function createAlert(input: AlertInput): Alert {
  return {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ...input,
  };
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  [AlertSeverity.LOW]:      "[ LOW      ]",
  [AlertSeverity.MEDIUM]:   "[ MEDIUM   ]",
  [AlertSeverity.HIGH]:     "[ HIGH     ]",
  [AlertSeverity.CRITICAL]: "[ CRITICAL ]",
};

export function logAlert(alert: Alert): void {
  const label = SEVERITY_LABEL[alert.severity];
  const line = "─".repeat(60);

  console.log(`\n${line}`);
  console.log(`${label} ${alert.message}`);
  console.log(line);
  console.log(`  ID:         ${alert.id}`);
  console.log(`  Time:       ${alert.timestamp}`);
  console.log(`  Proxy:      ${alert.proxyAddress}`);
  console.log(`  Impl:       ${alert.implementationAddress}`);
  console.log(`  Tx:         ${alert.txHash}`);
  console.log(`  Verified:   ${alert.isVerified ? "yes" : "no"}`);
  console.log(`  Layout:     ${alert.hasStorageLayout ? "yes" : "no"}`);
  if (alert.analysis) {
    console.log(`  AI Summary: ${alert.analysis.summary}`);
    console.log(`  AI Explain: ${alert.analysis.explanation}`);
    console.log(`  AI Advice:  ${alert.analysis.recommendation}`);
    console.log(`  Confidence: ${alert.analysis.confidence}`);
  }
  console.log(line);
}
