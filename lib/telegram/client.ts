import 'server-only'

const API_BASE = 'https://api.telegram.org'

/**
 * Sends a Markdown message to the configured Telegram chat. Never throws — a
 * notification failure must not break the operation that triggered it; failures
 * are logged and swallowed.
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping')
    return false
  }

  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[telegram] sendMessage failed:', res.status, body.slice(0, 300))
      return false
    }
    return true
  } catch (err) {
    console.error('[telegram] sendMessage error:', err)
    return false
  }
}
