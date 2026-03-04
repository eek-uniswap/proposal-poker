# Governance Executor Design

**Date:** 2026-03-04
**Project:** proposal-poker
**Summary:** TypeScript script that polls Uniswap Governor Bravo every 30 seconds, detects proposals eligible for execution, and submits the execute transaction.

---

## Architecture

Single TypeScript process running a polling loop. No framework — plain Node.js script with `viem` for chain interaction. Runs as an always-on Railway service.

**Runtime:** Node.js 20
**Chain:** Ethereum mainnet
**Governor:** Uniswap Governor Bravo — `0x408ED6354d4973f66138C91495F2f2FCbd8724C3`

**Environment variables:**
- `RPC_URL` — Ethereum mainnet RPC endpoint
- `PRIVATE_KEY` — wallet that submits execute transactions
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `TELEGRAM_CHAT_ID` — Telegram chat/channel ID to send alerts to

---

## File Structure

```
src/
  index.ts       — entry point, starts the 30s polling loop
  checker.ts     — one full poll cycle (read, filter, execute)
  notify.ts      — sends Telegram messages via Bot API
  contracts.ts   — Governor Bravo address + minimal ABI fragments
```

---

## Polling Cycle (every 30s)

1. Read `proposalCount()` from Governor Bravo
2. Build ID array `[94, 95, ..., proposalCount]`
3. Multicall `state(id)` for all IDs in one RPC call
4. Filter for IDs where `state == Queued (5)`
5. For each queued proposal: read `proposals(id).eta`
6. If `block.timestamp >= eta`: submit `execute(id)` transaction
7. Wait for receipt
8. Send Telegram alert + log on success or failure

---

## Data Flow

```
setInterval(30s)
  → proposalCount()                        [1 RPC call]
  → multicall state(94..N)                 [1 RPC call]
  → filter state == Queued
  → for each: proposals(id).eta            [1 call per queued proposal, usually 0–1]
  → if block.timestamp >= eta:
      → walletClient.writeContract execute(id)
      → waitForTransactionReceipt()
      → notify Telegram + log
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Tx reverts (already executed, eta not reached) | Catch, send Telegram alert with proposal ID + revert reason, continue loop |
| RPC error during read | Log, skip cycle — no Telegram alert (transient) |
| Telegram send fails | Log only — don't let alert failure crash the loop |
| Uncaught exception in cycle | Caught by top-level try/catch — log + continue |

---

## Contract ABI (minimal fragments)

```
proposalCount() → uint256
state(uint256 proposalId) → uint8   // 5 = Queued
proposals(uint256 proposalId) → { eta: uint256, ... }
execute(uint256 proposalId) → void  // payable
```

---

## Deduplication

Trust the contract — if a proposal has already been executed, `execute()` will revert with a clear reason. No local state required.

---

## Starting Proposal ID

Scan starts at ID **94** (earlier proposals are all resolved). Upper bound is `proposalCount()` read fresh each cycle.
