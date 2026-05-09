import axios from "axios";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🟢",
};

export async function sendTelegramAlert(alert: any, swarmUrl?: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;

  try {
    const emoji = SEVERITY_EMOJI[alert.severity] ?? "⚪";
    const verified = alert.isVerified ? "yes" : "no";
    const blockNumber = alert.rawData?.block?.number ?? "unknown";
    const summary = alert.analysis?.summary ?? "";

    const message = [
      `${emoji} <b>${alert.severity} UPGRADE DETECTED</b>`,
      ``,
      `🔷 Proxy: <code>${alert.proxyAddress}</code>`,
      `🔷 New Impl: <code>${alert.implementationAddress}</code>`,
      `⛓ Block: ${blockNumber}`,
      `✅ Verified: ${verified}`,
      summary ? `\n🤖 ${summary}` : null,
      swarmUrl ? `\n🗄 Swarm: ${swarmUrl}` : null,
      `🔍 <a href="https://basescan.org/tx/${alert.txHash}">View on Basescan</a>`,
    ].filter(Boolean).join("\n");

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    console.log(`[Telegram] Alert sent: ${alert.severity}`);
  } catch (err) {
    console.error(`[Telegram] Failed to send alert:`, err);
  }
}
