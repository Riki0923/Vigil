import OpenAI from "openai";
// import Groq from "groq-sdk";
import type { RiskFlag } from "../sourcify/diffFunctions.js";
import type { NatSpec } from "../sourcify/index.js";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

// Groq fallback — swap imports above and replace getClient() if needed:
// let groqClient: Groq | null = null;
// function getClient(): Groq {
//   if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
//   return groqClient;
// }

const SYSTEM_PROMPT =
  "You are Vigil, an autonomous smart contract security agent. " +
  "You analyse proxy upgrades on Ethereum and assess their risk. " +
  "Be concise, technical, and precise.";

export interface AnalysisResult {
  summary: string;
  explanation: string;
  recommendation: string;
  confidence: "low" | "medium" | "high";
}

export interface AnalyseUpgradeParams {
  proxyAddress: string;
  oldImplementation: string;
  newImplementation: string;
  storageDiff: unknown;
  abiDiff: unknown;
  functionRiskFlags: RiskFlag[];
  severity: string;
  natSpec?: NatSpec | null;
  sourceCode?: string;
}

export async function analyseUpgrade(
  params: AnalyseUpgradeParams
): Promise<AnalysisResult> {
  const {
    proxyAddress,
    oldImplementation,
    newImplementation,
    storageDiff,
    abiDiff,
    functionRiskFlags,
    severity,
    natSpec,
    sourceCode,
  } = params;

  const userMessage = `
Analyse this proxy upgrade and return a JSON object with fields:
- summary: one sentence describing what changed
- explanation: 2-3 sentences of technical detail about the risk
- recommendation: what the protocol team should do
- confidence: your confidence level — "low", "medium", or "high"

Upgrade details:
- Proxy: ${proxyAddress}
- Old implementation: ${oldImplementation}
- New implementation: ${newImplementation}
- Final assessed severity: ${severity}

Storage layout diff:
${JSON.stringify(storageDiff, null, 2)}

ABI diff:
${JSON.stringify(abiDiff, null, 2)}

Function risk flags:
${functionRiskFlags.length > 0
  ? functionRiskFlags.map((f) => `[${f.level}] ${f.message}`).join("\n")
  : "None"}
${natSpec ? `\nDeveloper documentation (NatSpec):
- Title: ${natSpec.title ?? "n/a"}
- Notice: ${natSpec.notice ?? "n/a"}
- Details: ${natSpec.details ?? "n/a"}
- Methods documented: ${Object.keys(natSpec.methods).length}` : ""}
${sourceCode ? `\nSource code excerpt:\n${sourceCode}` : ""}
`.trim();

  try {
    console.log(`[Analyser] Requesting AI analysis from OpenAI (gpt-4o)...`);

    const response = await getClient().chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "";
    const result = JSON.parse(content) as AnalysisResult;

    console.log(`[Analyser] Analysis complete (confidence: ${result.confidence})`);
    console.log(`  Summary: ${result.summary}`);

    return result;
  } catch (err) {
    console.error("[Analyser] AI call failed, returning fallback summary:", err);

    return {
      summary: `Proxy ${proxyAddress} upgraded to unanalysed implementation ${newImplementation}.`,
      explanation: `Automated AI analysis failed. The upgrade carries a severity of ${severity} based on diffs alone. Manual review is recommended.`,
      recommendation: "Review the new implementation manually before relying on this upgrade.",
      confidence: "low",
    };
  }
}
