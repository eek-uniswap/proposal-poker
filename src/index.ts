import 'dotenv/config'
import { createPublicClient, createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { runCheckerCycle } from './checker.js'

const INTERVAL_MS = 30_000

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined

  if (!rpcUrl) throw new Error('RPC_URL env var is required')
  if (!privateKey) throw new Error('PRIVATE_KEY env var is required')
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN env var is required')
  if (!process.env.TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID env var is required')

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
