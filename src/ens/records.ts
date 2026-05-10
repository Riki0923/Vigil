// Typed schema for the text records Vigil reads from and writes to ENS.
//
// Convention: keys under the `vigil.*` namespace are project-specific; bare keys
// (`description`, `url`) follow ENSIP-5. Values must be public, no secrets.

import type { AlertSeverity } from "../alerts/index.js";

export const RECORD_KEYS = {
  description: "description",
  url: "url",
  capabilities: "vigil.capabilities",
  feed: "vigil.feed",
  payment: "vigil.payment",
  severityMin: "vigil.severity-min",
  kind: "vigil.kind",
} as const;

export type AgentEnsConfig = {
  description: string | null;
  url: string | null;
  capabilities: AgentCapabilities | null;
  feed: string | null;
  payment: string | null;
  severityMin: AlertSeverity | null;
};

export type AgentCapabilities = {
  watch: string[];
  chains: string[];
  output: string[];
};

export type TargetEnsConfig = {
  description: string | null;
  kind: string | null;
  feed: string | null;
  baseSepoliaAddress: string | null;
};

export function parseCapabilities(raw: string | null): AgentCapabilities | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentCapabilities>;
    return {
      watch: Array.isArray(parsed.watch) ? parsed.watch.map(String) : [],
      chains: Array.isArray(parsed.chains) ? parsed.chains.map(String) : [],
      output: Array.isArray(parsed.output) ? parsed.output.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function parseSeverity(raw: string | null): AlertSeverity | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "LOW" || upper === "MEDIUM" || upper === "HIGH" || upper === "CRITICAL") {
    return upper as AlertSeverity;
  }
  return null;
}
