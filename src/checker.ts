import type { PublicClient, WalletClient } from 'viem'
import { GOVERNOR_BRAVO_ADDRESS, GOVERNOR_ABI, PROPOSAL_STATE } from './contracts.js'
import { notify as defaultNotify } from './notify.js'

const START_PROPOSAL_ID = 94n

export async function runCheckerCycle(
  publicClient: PublicClient,
  walletClient: WalletClient,
  notifyFn: (msg: string) => Promise<void> = defaultNotify
): Promise<void> {
  // 1. Get total proposal count
  const proposalCount = await publicClient.readContract({
    address: GOVERNOR_BRAVO_ADDRESS,
    abi: GOVERNOR_ABI,
    functionName: 'proposalCount',
  })

  // 2. Build ID range [94, ..., proposalCount]
  const ids: bigint[] = []
  for (let i = START_PROPOSAL_ID; i <= proposalCount; i++) {
    ids.push(i)
  }

  if (ids.length === 0) {
    console.log('[checker] No proposals to check (proposalCount < 94)')
    return
  }

  // 3. Batch-read all states via multicall
  const stateResults = await publicClient.multicall({
    contracts: ids.map((id) => ({
      address: GOVERNOR_BRAVO_ADDRESS,
      abi: GOVERNOR_ABI,
      functionName: 'state' as const,
      args: [id] as const,
    })),
  })

  // 4. Filter for Queued state (5)
  const queuedIds = ids.filter((_, index) => {
    const result = stateResults[index]
    return result.status === 'success' && result.result === PROPOSAL_STATE.Queued
  })

  if (queuedIds.length === 0) {
    console.log('[checker] No queued proposals found')
    return
  }

  console.log(`[checker] Found ${queuedIds.length} queued proposal(s): ${queuedIds.join(', ')}`)

  // 5. Get current block timestamp once
  const block = await publicClient.getBlock()
  const now = block.timestamp

  // 6. For each queued proposal, check eta and execute if ready
  for (const id of queuedIds) {
    const proposal = await publicClient.readContract({
      address: GOVERNOR_BRAVO_ADDRESS,
      abi: GOVERNOR_ABI,
      functionName: 'proposals',
      args: [id],
    })

    if (now < proposal.eta) {
      const secsRemaining = proposal.eta - now
      console.log(`[checker] Proposal ${id}: eta not reached (${secsRemaining}s remaining)`)
      continue
    }

    console.log(`[checker] Proposal ${id}: executing...`)

    try {
      const hash = await walletClient.writeContract({
        address: GOVERNOR_BRAVO_ADDRESS,
        abi: GOVERNOR_ABI,
        functionName: 'execute',
        args: [id],
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      if (receipt.status === 'reverted') {
        throw new Error('transaction reverted on-chain')
      }

      const message = `✅ Proposal ${id} executed successfully!\nTx: ${hash}`
      console.log(`[checker] ${message}`)
      await notifyFn(message)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const message = `❌ Failed to execute proposal ${id}\nReason: ${reason}`
      console.error(`[checker] ${message}`)
      await notifyFn(message)
    }
  }
}
