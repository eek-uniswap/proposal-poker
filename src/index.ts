import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { runCheckerCycle } from './checker.js'

const INTERVAL_MS = 30_000
const KEY_FILE = '.key'

function getOrCreatePrivateKey(): `0x${string}` {
  const fromEnv = process.env.PRIVATE_KEY
  if (fromEnv) {
    if (!fromEnv.startsWith('0x')) throw new Error('PRIVATE_KEY must start with 0x')
    return fromEnv as `0x${string}`
  }

  try {
    const stored = readFileSync(KEY_FILE, 'utf8').trim()
    if (stored.startsWith('0x')) return stored as `0x${string}`
  } catch {
    // file doesn't exist yet
  }

  const fresh = generatePrivateKey()
  writeFileSync(KEY_FILE, fresh, { mode: 0o600 })
  const address = privateKeyToAccount(fresh).address
  console.log(`[main] Generated new wallet: ${address}`)
  console.log(`[main] Private key saved to ${KEY_FILE} — send ETH to ${address} before transactions will succeed`)
  return fresh
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL

  if (!rpcUrl) throw new Error('RPC_URL env var is required')
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN env var is required')
  if (!process.env.TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID env var is required')

  const privateKey = getOrCreatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const transport = http(rpcUrl)

  const publicClient = createPublicClient({ chain: mainnet, transport })
  const walletClient = createWalletClient({ account, chain: mainnet, transport })

  console.log(`[main] Governance executor started. Wallet: ${account.address}`)
  console.log(`[main] Polling every ${INTERVAL_MS / 1000}s`)

  async function cycle(): Promise<void> {
    try {
      await runCheckerCycle(publicClient, walletClient)
    } catch (error) {
      console.error('[main] Unhandled cycle error:', error)
    }
  }

  // Run once immediately, then on interval
  await cycle()
  setInterval(cycle, INTERVAL_MS)
}

main().catch((error) => {
  console.error('[main] Fatal startup error:', error)
  process.exit(1)
})
