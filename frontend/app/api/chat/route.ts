import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { loadAlerts } from "@/lib/load-alerts";
import type { Alert } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM_PROMPT_TEMPLATE = (alert: Alert) => `
You are Vigil, an autonomous Ethereum smart-contract security analyst.
You are answering questions about ONE specific proxy upgrade alert that the
user has selected on their dashboard. Reason ONLY from the alert data
provided below; if the data does not support an answer, say so clearly.
Be concise, technical, and precise. Prefer concrete claims grounded in the
data over generic warnings. When relevant, cite specific fields
(e.g. "rawData.storageDiff.movedVariables[0]" or "analysis.recommendation").

ALERT DATA (JSON):
${JSON.stringify(alert, null, 2)}
`.trim();

export async function POST(req: Request) {
  let body: { messages?: UIMessage[]; alertId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { messages, alertId } = body;
  if (!alertId) return new Response("alertId is required", { status: 400 });
  if (!Array.isArray(messages)) {
    return new Response("messages must be an array", { status: 400 });
  }

  const { alerts } = await loadAlerts();
  const alert = alerts.find((a) => a.id === alertId);
  if (!alert) return new Response("Alert not found", { status: 404 });

  const modelMessages = await convertToModelMessages(messages);
  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: SYSTEM_PROMPT_TEMPLATE(alert),
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
