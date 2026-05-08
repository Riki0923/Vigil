import OpenAI from "openai";
// import Groq from "groq-sdk";

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
  diff: unknown;
  severity: string;
  sourceCode?: string;
}

export async function analyseUpgrade(
  params: AnalyseUpgradeParams
): Promise<AnalysisResult> {
  const { proxyAddress, oldImplementation, newImplementation, diff, severity, sourceCode } = params;

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
- Assessed severity: ${severity}
- Storage layout diff:
${JSON.stringify(diff, null, 2)}
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
      explanation: `Automated AI analysis failed. The upgrade carries a severity of ${severity} based on storage layout diff alone. Manual review is recommended.`,
      recommendation: "Review the new implementation manually before relying on this upgrade.",
      confidence: "low",
    };
  }
}
