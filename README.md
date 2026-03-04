# proposal-poker

Watches Uniswap Governor Bravo for queued governance proposals and executes them once their timelock has elapsed.

## How it works

Every 30 seconds:

1. Reads `proposalCount` from Governor Bravo
2. Multicalls `state(id)` for all proposals ≥ 94
3. For any proposal in `Queued` state, checks if `block.timestamp >= eta`
4. If ready, calls `execute(proposalId)` — forwarding any ETH the proposal's actions require
5. Sends a Telegram alert on success or failure

## Setup

```bash
npm install
cp .env.example .env
# fill in .env
npm start
```

## Environment variables

| Variable | Description |
|---|---|
| `RPC_URL` | Ethereum mainnet RPC endpoint |
| `PRIVATE_KEY` | Wallet that submits execute transactions (must start with `0x`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Telegram chat/channel ID for alerts |

> **Note:** Some proposals send ETH as part of their execution (e.g. cross-chain messages to Arbitrum). Your wallet needs enough ETH to cover these forwarded values in addition to gas. The bot reads each proposal's required value dynamically.

## Tests

```bash
# Unit tests (no RPC required)
npm test

# Fork test — executes proposal 94 against a mainnet fork
RPC_URL=<your-rpc-url> npm run test:fork
```

The fork test requires [Foundry's `anvil`](https://book.getfoundry.sh/getting-started/installation).

## Contract

Governor Bravo: [`0x408ED6354d4973f66138C91495F2f2FCbd8724C3`](https://etherscan.io/address/0x408ED6354d4973f66138C91495F2f2FCbd8724C3)
