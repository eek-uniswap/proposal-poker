# Governance Executor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** TypeScript script that polls Uniswap Governor Bravo every 30 seconds, detects proposals (ID ≥ 94) in Queued state with eta reached, and submits `execute()` transactions.

**Architecture:** Single Node.js process with a `setInterval` polling loop. `checker.ts` takes injected viem clients for testability. `notify.ts` wraps the Telegram Bot API. No build step — `tsx` runs TypeScript directly on Railway.

**Tech Stack:** TypeScript, viem ^2, tsx, vitest, dotenv

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Create `package.json`**

```json
{
  "name": "proposal-poker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

**Step 3: Create `.env.example`**

```
RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
PRIVATE_KEY=0x...
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=-100123456789
```

**Step 4: Create `.gitignore`**

```
node_modules/
.env
dist/
```

**Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

**Step 6: Commit**

```bash
git init
git add package.json tsconfig.json .env.example .gitignore
git commit -m "chore: scaffold project"
```

---

## Task 2: Contract constants

**Files:**
- Create: `src/contracts.ts`

**Step 1: Create `src/contracts.ts`**

```typescript
export const GOVERNOR_BRAVO_ADDRESS =
  '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const

export const PROPOSAL_STATE = {
  Pending: 0,
  Active: 1,
  Canceled: 2,
  Defeated: 3,
  Succeeded: 4,
  Queued: 5,
  Expired: 6,
  Executed: 7,
} as const

export const GOVERNOR_ABI = [
  {
    name: 'proposalCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'state',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'proposals',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'proposer', type: 'address' },
      { name: 'eta', type: 'uint256' },
      { name: 'startBlock', type: 'uint256' },
      { name: 'endBlock', type: 'uint256' },
      { name: 'forVotes', type: 'uint256' },
      { name: 'againstVotes', type: 'uint256' },
      { name: 'abstainVotes', type: 'uint256' },
      { name: 'canceled', type: 'bool' },
      { name: 'executed', type: 'bool' },
    ],
  },
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [],
  },
] as const
```

**Step 2: Commit**

```bash
git add src/contracts.ts
git commit -m "feat: add Governor Bravo contract constants and ABI"
```

---

## Task 3: Telegram notifier

**Files:**
- Create: `src/notify.ts`
- Create: `tests/notify.test.ts`

**Step 1: Write the failing tests first**

Create `tests/notify.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../src/notify.js'`

**Step 3: Implement `src/notify.ts`**

```typescript
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
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add src/notify.ts tests/notify.test.ts
git commit -m "feat: add Telegram notifier with tests"
```

---

## Task 4: Checker — core polling logic

**Files:**
- Create: `src/checker.ts`
- Create: `tests/checker.test.ts`

**Step 1: Write the failing tests**

Create `tests/checker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCheckerCycle } from '../src/checker.js'
import { GOVERNOR_BRAVO_ADDRESS, GOVERNOR_ABI } from '../src/contracts.js'

// Minimal mock types — only the methods we use
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
    publicClient.readContract.mockResolvedValue(93n) // proposalCount = 93

    await runCheckerCycle(publicClient as any, walletClient as any, notifyFn)

    expect(publicClient.multicall).not.toHaveBeenCalled()
    expect(notifyFn).not.toHaveBeenCalled()
  })

  it('does nothing when no proposals are in Queued state', async () => {
    const { publicClient, walletClient } = makeClients()
    publicClient.readContract.mockResolvedValue(95n) // proposals 94, 95
    publicClient.multicall.mockResolvedValue([
      { status: 'success', result: 7 }, // Executed
      { status: 'success', result: 1 }, // Active
    ])

    await runCheckerCycle(publicClient as any, walletClient as any, notifyFn)

    expect(walletClient.writeContract).not.toHaveBeenCalled()
    expect(notifyFn).not.toHaveBeenCalled()
  })

  it('skips queued proposals where eta has not been reached', async () => {
    const { publicClient, walletClient } = makeClients()
    const futureEta = BigInt(Math.floor(Date.now() / 1000) + 10000)

    publicClient.readContract
      .mockResolvedValueOnce(94n) // proposalCount
      .mockResolvedValueOnce({ eta: futureEta }) // proposals(94)

    publicClient.multicall.mockResolvedValue([
      { status: 'success', result: 5 }, // Queued
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
      .mockResolvedValueOnce(94n) // proposalCount
      .mockResolvedValueOnce({ eta: pastEta }) // proposals(94)

    publicClient.multicall.mockResolvedValue([
      { status: 'success', result: 5 }, // Queued
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
    expect(notifyFn).toHaveBeenCalledWith(
      expect.stringContaining('94')
    )
    expect(notifyFn).toHaveBeenCalledWith(
      expect.stringContaining(txHash)
    )
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
    walletClient.writeContract.mockRejectedValue(new Error('execution reverted: already executed'))

    await expect(
      runCheckerCycle(publicClient as any, walletClient as any, notifyFn)
    ).resolves.not.toThrow()

    expect(notifyFn).toHaveBeenCalledWith(
      expect.stringContaining('94')
    )
    expect(notifyFn).toHaveBeenCalledWith(
      expect.stringContaining('already executed')
    )
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../src/checker.js'`

**Step 3: Implement `src/checker.ts`**

```typescript
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

      await publicClient.waitForTransactionReceipt({ hash })

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
```

**Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: All tests PASS (notify tests + checker tests)

**Step 5: Commit**

```bash
git add src/checker.ts tests/checker.test.ts
git commit -m "feat: add checker with multicall polling and execute logic"
```

---

## Task 5: Entry point and polling loop

**Files:**
- Create: `src/index.ts`

**Step 1: Create `src/index.ts`**

```typescript
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
```

**Step 2: Smoke test locally (optional — requires a real .env)**

```bash
cp .env.example .env
# fill in RPC_URL and TELEGRAM_BOT_TOKEN/CHAT_ID
# set PRIVATE_KEY to a funded wallet
tsx src/index.ts
```

Expected: logs `Governance executor started`, then `No queued proposals found` (or executes if one is ready).

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add polling entry point with startup validation"
```

---

## Task 6: Railway deployment config

**Files:**
- Create: `railway.toml`

**Step 1: Create `railway.toml`**

```toml
[deploy]
startCommand = "npm start"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

**Step 2: Add environment variables in Railway dashboard**

In the Railway project settings, add:
- `RPC_URL` — mainnet RPC (Alchemy/Infura recommended for reliability)
- `PRIVATE_KEY` — wallet private key
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

**Step 3: Commit and push**

```bash
git add railway.toml
git commit -m "chore: add Railway deployment config"
```

Then connect the repo to Railway and deploy.

---

## Final verification

```bash
npm test
```

Expected output:
```
✓ tests/notify.test.ts (3 tests)
✓ tests/checker.test.ts (5 tests)

Test Files  2 passed
Tests       8 passed
```
