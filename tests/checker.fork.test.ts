/**
 * Fork test for proposal 94 execution.
 * Requires: RPC_URL env var + anvil (https://book.getfoundry.sh/getting-started/installation)
 *
 * Run with: npm run test:fork
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestClient, createPublicClient, createWalletClient, http, publicActions } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createAnvil } from '@viem/anvil'
import { runCheckerCycle } from '../src/checker.js'
import { GOVERNOR_BRAVO_ADDRESS, GOVERNOR_ABI } from '../src/contracts.js'

// Anvil default account 0 — well-known dev key, 10_000 ETH pre-funded
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

const FORK_PORT = 8546
const forkUrl = process.env.RPC_URL

describe.skipIf(!forkUrl)('checker fork test (proposal 94)', () => {
  const anvil = createAnvil({ forkUrl: forkUrl!, port: FORK_PORT })
  const rpcUrl = `http://127.0.0.1:${FORK_PORT}`

  beforeAll(async () => {
    await anvil.start()
  }, 30_000)

  afterAll(async () => {
    await anvil.stop()
  })

  it('executes proposal 94 after warping 2 days past its eta', async () => {
    const transport = http(rpcUrl)

    const testClient = createTestClient({
      chain: mainnet,
      mode: 'anvil',
      transport,
    }).extend(publicActions)

    const publicClient = createPublicClient({ chain: mainnet, transport })

    const walletClient = createWalletClient({
      account: privateKeyToAccount(TEST_PRIVATE_KEY),
      chain: mainnet,
      transport,
    })

    // Read proposal 94's eta from the fork
    const proposal = await publicClient.readContract({
      address: GOVERNOR_BRAVO_ADDRESS,
      abi: GOVERNOR_ABI,
      functionName: 'proposals',
      args: [94n],
    })

    expect(proposal.eta).toBeGreaterThan(0n)

    // Confirm it's currently Queued (5)
    const stateBefore = await publicClient.readContract({
      address: GOVERNOR_BRAVO_ADDRESS,
      abi: GOVERNOR_ABI,
      functionName: 'state',
      args: [94n],
    })
    expect(stateBefore).toBe(5)

    // Warp 2 days past eta
    const targetTimestamp = proposal.eta + BigInt(2 * 24 * 60 * 60)
    await testClient.setNextBlockTimestamp({ timestamp: targetTimestamp })
    await testClient.mine({ blocks: 1 })

    // Run the checker — it should detect and execute proposal 94
    const notifications: string[] = []
    await runCheckerCycle(publicClient as any, walletClient as any, async (msg) => {
      notifications.push(msg)
    })

    // Proposal should now be Executed (7)
    const stateAfter = await publicClient.readContract({
      address: GOVERNOR_BRAVO_ADDRESS,
      abi: GOVERNOR_ABI,
      functionName: 'state',
      args: [94n],
    })

    expect(stateAfter).toBe(7)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toContain('94')
    expect(notifications[0]).toContain('✅')
  }, 120_000)
})
