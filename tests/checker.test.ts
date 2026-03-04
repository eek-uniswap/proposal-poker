import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCheckerCycle } from '../src/checker.js'
import { GOVERNOR_BRAVO_ADDRESS } from '../src/contracts.js'

type MockPublicClient = {
  readContract: ReturnType<typeof vi.fn>
  multicall: ReturnType<typeof vi.fn>
  getBlock: ReturnType<typeof vi.fn>
  waitForTransactionReceipt: ReturnType<typeof vi.fn>
}

type MockWalletClient = {
  writeContract: ReturnType<typeof vi.fn>
}

function makeClients() {
  const publicClient: MockPublicClient = {
    readContract: vi.fn(),
    multicall: vi.fn(),
    getBlock: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  }
  const walletClient: MockWalletClient = {
    writeContract: vi.fn(),
  }
  return { publicClient, walletClient }
}

describe('runCheckerCycle', () => {
  let notifyFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    notifyFn = vi.fn().mockResolvedValue(undefined)
  })

  it('does nothing when proposalCount < START_ID', async () => {
    const { publicClient, walletClient } = makeClients()
    publicClient.readContract.mockResolvedValue(93n)

    await runCheckerCycle(publicClient as any, walletClient as any, notifyFn)

    expect(publicClient.multicall).not.toHaveBeenCalled()
    expect(notifyFn).not.toHaveBeenCalled()
  })

  it('does nothing when no proposals are in Queued state', async () => {
    const { publicClient, walletClient } = makeClients()
    publicClient.readContract.mockResolvedValue(95n)
    publicClient.multicall.mockResolvedValue([
      { status: 'success', result: 7 },
      { status: 'success', result: 1 },
    ])

    await runCheckerCycle(publicClient as any, walletClient as any, notifyFn)

    expect(walletClient.writeContract).not.toHaveBeenCalled()
    expect(notifyFn).not.toHaveBeenCalled()
  })

  it('skips queued proposals where eta has not been reached', async () => {
    const { publicClient, walletClient } = makeClients()
    const futureEta = BigInt(Math.floor(Date.now() / 1000) + 10000)

    publicClient.readContract
      .mockResolvedValueOnce(94n)
      .mockResolvedValueOnce({ eta: futureEta })

    publicClient.multicall.mockResolvedValue([
      { status: 'success', result: 5 },
    ])
    publicClient.getBlock.mockResolvedValue({
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    })

    await runCheckerCycle(publicClient as any, walletClient as any, notifyFn)

    expect(walletClient.writeContract).not.toHaveBeenCalled()
    expect(notifyFn).not.toHaveBeenCalled()
  })

  it('executes a queued proposal when eta is reached and notifies success', async () => {
    const { publicClient, walletClient } = makeClients()
    const pastEta = BigInt(Math.floor(Date.now() / 1000) - 100)
    const txHash = '0xabc123' as `0x${string}`

    publicClient.readContract
      .mockResolvedValueOnce(94n)
      .mockResolvedValueOnce({ eta: pastEta })

    publicClient.multicall.mockResolvedValue([
      { status: 'success', result: 5 },
    ])
    publicClient.getBlock.mockResolvedValue({
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    })
    walletClient.writeContract.mockResolvedValue(txHash)
    publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })

    await runCheckerCycle(publicClient as any, walletClient as any, notifyFn)

    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: GOVERNOR_BRAVO_ADDRESS,
        functionName: 'execute',
        args: [94n],
      })
    )
    expect(notifyFn).toHaveBeenCalledWith(expect.stringContaining('94'))
    expect(notifyFn).toHaveBeenCalledWith(expect.stringContaining(txHash))
  })

  it('notifies on execute failure without throwing', async () => {
    const { publicClient, walletClient } = makeClients()
    const pastEta = BigInt(Math.floor(Date.now() / 1000) - 100)

    publicClient.readContract
      .mockResolvedValueOnce(94n)
      .mockResolvedValueOnce({ eta: pastEta })

    publicClient.multicall.mockResolvedValue([
      { status: 'success', result: 5 },
    ])
    publicClient.getBlock.mockResolvedValue({
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    })
    walletClient.writeContract.mockRejectedValue(
      new Error('execution reverted: already executed')
    )

    await expect(
      runCheckerCycle(publicClient as any, walletClient as any, notifyFn)
    ).resolves.not.toThrow()

    expect(notifyFn).toHaveBeenCalledWith(expect.stringContaining('94'))
    expect(notifyFn).toHaveBeenCalledWith(
      expect.stringContaining('already executed')
    )
  })
})
