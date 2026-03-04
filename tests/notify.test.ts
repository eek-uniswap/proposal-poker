import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Must import AFTER stubbing globals
async function importNotify() {
  vi.resetModules()
  return import('../src/notify.js')
}

describe('notify', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = 'test-chat-id'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to the correct Telegram URL with message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
    const { notify } = await importNotify()

    await notify('hello world')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: 'test-chat-id', text: 'hello world' }),
      })
    )
  })

  it('does not throw when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const { notify } = await importNotify()
    await expect(notify('test')).resolves.toBeUndefined()
  })

  it('does not throw when response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Too Many Requests'),
      })
    )
    const { notify } = await importNotify()
    await expect(notify('test')).resolves.toBeUndefined()
  })
})
