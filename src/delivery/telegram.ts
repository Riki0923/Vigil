import axios from "axios";

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🟢",
};

export async function sendTelegramAlert(alert: any, swarmUrl?: string): Promise<void> {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  console.log('[Telegram] Token:', TELEGRAM_BOT_TOKEN?.substring(0, 20));
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Missing token or chat ID — skipping');
    return;
  }

  let message: string;
  try {
    const emoji = SEVERITY_EMOJI[alert.severity] ?? '⚪';
    const verified = alert.isVerified ? 'yes' : 'no';
    const blockNumber = alert.rawData?.block?.number ?? alert.block?.number ?? 'unknown';
    const summary = alert.analysis?.summary ?? '';
    message = [
      `${emoji} <b>${alert.severity} UPGRADE DETECTED</b>`,
      ``,
      `🔷 Proxy: <code>${alert.proxyAddress}</code>`,
      `🔷 New Impl: <code>${alert.implementationAddress}</code>`,
      `⛓ Block: ${blockNumber}`,
      `✅ Verified: ${verified}`,
      summary ? `\n🤖 ${summary}` : null,
      swarmUrl ? `\n🗄 Swarm: ${swarmUrl}` : null,
      `🔍 <a href="https://basescan.org/tx/${alert.txHash}">View on Basescan</a>`,
    ].filter(Boolean).join('\n');
  } catch (buildErr: any) {
    console.error('[Telegram] Failed to build message:', buildErr.message);
    message = `⚠️ Vigil Alert: ${alert.severity} upgrade detected at ${alert.proxyAddress}`;
  }

  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }
    );
    console.log('[Telegram] Response status:', response.status);
    console.log('[Telegram] Response data:', JSON.stringify(response.data));
  } catch (err: any) {
    console.error('[Telegram] Error status:', err.response?.status);
    console.error('[Telegram] Error data:', JSON.stringify(err.response?.data));
    console.error('[Telegram] Error message:', err.message);
  }
}
