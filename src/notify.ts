export async function notify(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN!
  const chatId = process.env.TELEGRAM_CHAT_ID!
  const url = `https://api.telegram.org/bot${token}/sendMessage`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    })
    if (!response.ok) {
      console.error(
        `[notify] Telegram send failed: ${response.status} ${await response.text()}`
      )
    }
  } catch (error) {
    console.error('[notify] Telegram send error:', error)
  }
}
