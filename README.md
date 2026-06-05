# Fluid Data Reader

Read-only REST API service that fetches DeFi positions from [Fluid Protocol](https://fluid.instadapp.io) on Base network via on-chain resolver contracts. Designed to be consumed from Google Apps Script or any HTTP client.

## Features

- Reads all vault positions for a given wallet address automatically
- Converts raw on-chain amounts to human-readable values
- Fetches live USD prices via DeFiLlama (CoinGecko as fallback)
- 60-second in-memory cache to minimize RPC calls
- Fully Dockerized with healthcheck

## Requirements

- Docker & Docker Compose
- A Base RPC endpoint (e.g. [Alchemy](https://dashboard.alchemy.com))

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/vladyspavlov/fluid-data-reader.git
cd fluid-data-reader

# 2. Set your RPC URL
echo "BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY" > .env

# 3. Start the service
docker compose up -d

# 4. Check it's healthy
curl http://localhost:3000/health
```

## API

### `GET /health`

```json
{ "status": "ok", "timestamp": "2026-06-06T10:00:00.000Z" }
```

### `GET /positions?address=0x...`

### `POST /positions`
```json
{ "address": "0x..." }
```

**Response 200:**
```json
{
  "address": "0x...",
  "chain": "base",
  "timestamp": "2026-06-06T10:00:00.000Z",
  "positions": [
    {
      "nftId": "42",
      "vault": "0x...",
      "collateral": {
        "token": "cbBTC",
        "tokenAddress": "0x...",
        "decimals": 8,
        "amountRaw": "100000",
        "amount": "0.001",
        "valueUSD": 97.50
      },
      "debt": {
        "token": "USDC",
        "tokenAddress": "0x...",
        "decimals": 6,
        "amountRaw": "50000000",
        "amount": "50.00",
        "valueUSD": 50.00
      },
      "rates": {
        "supplyAPY": 0.0002,
        "borrowAPY": 0.0850,
        "netAPY": -0.0848
      },
      "health": {
        "collateralFactor": 0.85,
        "liquidationThreshold": 0.90,
        "healthFactor": 2.4,
        "isLiquidatable": false
      },
      "netValueUSD": 47.50,
      "netValueETH": 0.0185,
      "netValueBTC": 0.000489
    }
  ],
  "summary": {
    "totalCollateralUSD": 4777.50,
    "totalDebtUSD": 2050.00,
    "totalNetValueUSD": 2727.50,
    "totalNetValueETH": 1.0605,
    "totalNetValueBTC": 0.0272,
    "weightedSupplyAPY": 0.00041,
    "weightedBorrowAPY": 0.08340
  },
  "prices": {
    "ETH_USD": 2570.00,
    "BTC_USD": 97500.00,
    "cbBTC_USD": 97500.00,
    "wstETH_USD": 3900.00,
    "USDC_USD": 1.00
  }
}
```

**Error responses:**

| Code | `error` | Meaning |
|------|---------|---------|
| 400 | `invalid_address` | Address is not a valid EVM address |
| 500 | `rpc_timeout` | Base RPC did not respond within 10s |
| 500 | `rpc_rate_limit` | RPC rate limit hit |
| 500 | `rpc_error` | Other on-chain error |

When the price API is unavailable all `valueUSD`, `netValueUSD`, `netValueETH`, `netValueBTC`, and summary USD fields are returned as `null`, and `prices` is `null`.

## Configuration

All defaults are baked into `docker-compose.yml`. Only secrets need to be provided.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BASE_RPC_URL` | **yes** | — | Base RPC endpoint |
| `COINGECKO_API_KEY` | no | `""` | CoinGecko key for fallback prices |
| `PORT` | no | `3000` | HTTP port |
| `CACHE_TTL_SECONDS` | no | `60` | Position cache TTL |
| `LOG_LEVEL` | no | `info` | Log verbosity |
| `FLUID_VAULT_RESOLVER` | no | see compose | Resolver contract address |
| `FLUID_VAULT_POSITIONS_RESOLVER` | no | see compose | Positions resolver address |
| `FLUID_VAULT_FACTORY` | no | see compose | VaultFactory address |
| `TOKEN_CBBTC` | no | see compose | cbBTC token address on Base |
| `TOKEN_WSTETH` | no | see compose | wstETH token address on Base |
| `TOKEN_USDC` | no | see compose | USDC token address on Base |

## Local Development

```bash
npm install
cp .env.example .env   # then fill in BASE_RPC_URL
npm run dev            # tsx watch — hot reload
npm run typecheck      # type check without emitting
npm run build          # compile to dist/
```

## Tech Stack

- **Runtime:** Node.js 24 LTS
- **HTTP:** Express 5
- **Web3:** viem 2
- **Language:** TypeScript
- **Prices:** DeFiLlama (primary), CoinGecko (fallback)
- **Docker:** node:24-alpine

## License

[MIT](LICENSE)
