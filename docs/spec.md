# Spec: Fluid Data Reader — Node.js + Docker Service

**Scope:** Standalone microservice for reading user positions on Fluid Protocol (Base network).
Does not depend on Google Apps Script — it is an autonomous HTTP API that GAS (or any other client) can consume.

---

## 1. Context

Fluid does not provide a hosted REST JSON API for reading positions. Data is available only through on-chain **resolver contracts** on Base:

- `FluidVaultResolver` — vault data (tokens, rates, metadata)
- `FluidVaultPositionsResolver` — batch reading of positions by NFT ID
- `FluidLendingResolver` — fToken positions (if needed)

Reading requires `eth_call` to a Base RPC + ABI decoding of complex structs. This is impossible without `viem`/`ethers.js`, hence the need for a separate Node service.

---

## 2. Positions to Read

Two vault positions for one wallet on Base are tracked:

| Position | Collateral | Debt | Type |
|---------|-----------|------|-----|
| Vault 1 | cbBTC | USDC | VaultT1 |
| Vault 2 | wstETH | USDC | VaultT1 |

The wallet address is configured via `.env`. The service discovers all vault NFT IDs automatically — it does not hardcode them.

---

## 3. Service Architecture

```
GET/POST /positions  ←── GAS or another client
         ↓
    Express.js
         ↓
    FluidService
    ├── vaultResolver.getAllVaultNftIdByOwner(address)
    │         → nftIds[]
    ├── vaultPositionsResolver.getPositionsForNftIds(nftIds)
    │         → UserPosition[]
    ├── vaultResolver.getVaultEntireData(vaultAddress)
    │         → VaultEntireData (per vault)
    ├── convertRawToActual(rawAmount, exchangePrice)
    └── PriceService (CoinGecko or DeFiLlama)
              ↓
         JSON response
```

---

## 4. On-Chain Data Flow — Details

### Step 1: Get all vault NFT IDs for the user

**Contract:** `FluidVaultFactory`
**Method:** `getUserNfts(address owner)` → `uint256[] nftIds`

> Alternative: if VaultFactory does not have a direct method, use `FluidVaultPositionsResolver`:

**Contract:** `FluidVaultPositionsResolver`
**Method:** `getAllPositionsByUser(address user)` — if it exists, or via VaultFactory nftIds.

**Fallback:** `ERC721.tokensOfOwner(address)` on the VaultFactory contract (it is ERC721 for vault NFTs).

### Step 2: Batch read positions

**Contract:** `FluidVaultPositionsResolver`
**Method:** `getPositionsForNftIds(uint256[] nftIds)` → `UserPosition[]`

One eth_call for all positions simultaneously — efficient.

**UserPosition struct:**
```
struct UserPosition {
    uint256 nftId;
    address vault;
    address owner;
    bool isLiquidatable;
    uint256 tick;        // position in liquidity tree
    uint256 tickId;
    uint256 col;         // RAW collateral (requires conversion)
    uint256 debt;        // RAW debt (requires conversion)
    uint256 colUnderlying;   // actual collateral (in Fluid v2 may be provided directly)
    uint256 debtUnderlying;  // actual debt (in Fluid v2 may be provided directly)
}
```

### Step 3: Data per vault

**Contract:** `FluidVaultResolver`
**Method:** `getVaultEntireData(address vault)` → `VaultEntireData`

Key fields of `VaultEntireData`:
```
supplyToken: address          // cbBTC or wstETH
borrowToken: address          // USDC
supplyDecimals: uint8
borrowDecimals: uint8
supplyExchangePrice: uint256  // for RAW → actual conversion
borrowExchangePrice: uint256  // for RAW → actual conversion
supplyRate: uint256           // supplier APY (in annual %)
borrowRate: uint256           // borrower APY (in annual %)
collateralFactor: uint256     // LTV cap
liquidationThreshold: uint256
oraclePrice: uint256          // current price col/debt
```

### Step 4: RAW → Actual amount conversion

Fluid stores amounts as "raw" values. The actual amount:

```
actualColAmount  = (col  * supplyExchangePrice) / 1e12
actualDebtAmount = (debt * borrowExchangePrice) / 1e12
```

> **Important:** exchange price precision = 1e12. If the result doesn't match, check
> `VaultEntireData.vaultState.supplyExchangePrice` and `borrowExchangePrice` from
> `VaultEntireData.vaultState`. Decimal conversion also depends on `supplyDecimals`.

If `colUnderlying` and `debtUnderlying` are already present in `UserPosition` (Fluid v2+), use them directly — they are already decoded.

### Step 5: Rates (APY)

**Method:** `getVaultEntireData(vault).vaultState.rates`

Or via `FluidLendingResolver` for fToken rates (if there are lending positions):
`getLendingData(fTokenAddress)` → `{ supplyRate, borrowRate }`

Rates in Fluid are stored as `uint256` in **basis points per year** (bps) format, or as annual percentage * 1e4.
Example: `850000` = 85% annually — verify exact precision in VaultEntireData via a real eth_call.

---

## 5. Contracts on Base — Addresses

Exact deployed addresses must be taken from official sources, **not hardcoded without verification**:

**Source 1 (official):** [github.com/Instadapp/fluid-deployments](https://github.com/Instadapp/fluid-deployments/blob/main/deployments.md)
**Source 2:** docs.fluid.instadapp.io/contracts/contract-addresses.html *(JS render, open in browser)*
**Source 3:** Base block explorer (basescan.org) — verified contracts

Contracts to find (names in deployments.md):
```
FluidVaultResolver          → "vaultResolver"
FluidVaultPositionsResolver → "vaultPositionsResolver"
FluidVaultFactory           → "vaultFactory"
FluidLendingResolver        → "lendingResolver"  (if needed)
```

> Chain ID Base = `8453`

**ABI sources:**
`github.com/Instadapp/fluid-contracts-public` → `/out/` or `/abi/`
Or extract from Basescan for specific deployed addresses.

---

## 6. Service REST API

### `GET /health`

```json
{ "status": "ok", "timestamp": "2026-06-06T10:00:00Z" }
```

---

### `GET /positions?address=0x...`

or

### `POST /positions`
```json
{ "address": "0x..." }
```

**Response 200:**
```json
{
  "address": "0x...",
  "chain": "base",
  "timestamp": "2026-06-06T10:00:00Z",
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
    "wstETH_USD": 3900.00
  }
}
```

**Response 400:**
```json
{ "error": "invalid_address", "message": "address must be a valid EVM address" }
```

**Response 500:**
```json
{ "error": "rpc_error", "message": "Base RPC unavailable", "retryAfter": 30 }
```

---

## 7. Price Service

The service fetches prices independently for converting positions to USD/ETH/BTC.

**API:** DeFiLlama prices (primary — no rate limit, fast):
```
GET https://coins.llama.fi/prices/current/
    base:0x...,base:0x...,coingecko:bitcoin,coingecko:ethereum
```

**Alternative:** CoinGecko API (free tier, no key, but rate-limited: ~5-50 req/min).

**Tokens on Base:**
- cbBTC: `base:0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf`
- wstETH: `base:0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452`
- USDC: `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

---

## 8. Caching

The service is stateless, but to avoid eth_call on every GAS request:

- **Cache TTL:** 60 seconds (in-memory, `Map<address, {data, expiry}>`)
- **Logic:** if `Date.now() < expiry` → return cache, otherwise fresh fetch
- **Cache key:** `${address.toLowerCase()}`
- **External cache (optional):** Redis for multiple instances (not needed for single-instance Docker)

---

## 9. Tech Stack

| Component | Solution | Rationale |
|-----------|---------|---------------|
| Runtime | Node.js 24 LTS | Long-term support |
| HTTP server | Express.js 5.x | Simple, stable |
| Web3 | viem 2.x | Modern API, TypeScript-first, smaller bundle than ethers |
| Env | dotenv | Standard |
| Logging | console.log / pino | pino if structured JSON logs are needed |
| Docker base | `node:24-alpine` | Minimal image |
| Language | TypeScript | Recommended for ABI struct typing |

---

## 10. Project Structure

```
fluid-data-reader/
├── src/
│   ├── index.ts              # Express app, listen
│   ├── routes/
│   │   └── positions.ts      # GET/POST /positions, GET /health
│   ├── services/
│   │   ├── FluidService.ts   # Main logic: resolver calls, decode
│   │   ├── PriceService.ts   # Prices from DeFiLlama/CoinGecko
│   │   └── CacheService.ts   # In-memory TTL cache
│   ├── abi/
│   │   ├── FluidVaultResolver.json
│   │   ├── FluidVaultPositionsResolver.json
│   │   └── FluidVaultFactory.json
│   ├── config/
│   │   └── contracts.ts      # Contract addresses from .env
│   └── utils/
│       └── conversion.ts     # raw → actual amount helpers
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── CLAUDE.md
```

---

## 11. Configuration

All configuration is provided via environment variables. Defaults are baked into `docker-compose.yml`; only secrets (`BASE_RPC_URL`, `COINGECKO_API_KEY`) must be set by the user before starting.

```dotenv
# Base RPC — required, must be set by user
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# Port
PORT=3000

# Fluid contract addresses on Base (verified from fluid-deployments)
FLUID_VAULT_RESOLVER=0x1500D70D8551B828f8fb56fa739c977D113444Df
FLUID_VAULT_POSITIONS_RESOLVER=0x91214D70b3981276Ff3b8361552D99BA41C41A7d
FLUID_VAULT_FACTORY=0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d

# Token addresses on Base
TOKEN_CBBTC=0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf
TOKEN_WSTETH=0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452
TOKEN_USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Cache TTL in seconds
CACHE_TTL_SECONDS=60

# CoinGecko API key — optional, for fallback price feed
COINGECKO_API_KEY=

# Log level
LOG_LEVEL=info
```

> **Security:** `.env` does not go into the image. Pass via `docker run --env-file` or docker-compose `env_file`.
> **Secrets:** only `BASE_RPC_URL` and `COINGECKO_API_KEY` are sensitive. No private keys — the service is read-only.

---

## 12. Dockerfile

```dockerfile
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
```

---

## 13. docker-compose.yml

Defaults are embedded in `docker-compose.yml`. The user only needs to set `BASE_RPC_URL` (and optionally `COINGECKO_API_KEY`) in their shell or a `.env` file before running `docker compose up`.

```yaml
services:
  fluid-service:
    build: .
    container_name: fluid-reader
    ports:
      - "3000:3000"
    environment:
      BASE_RPC_URL: ${BASE_RPC_URL}
      COINGECKO_API_KEY: ${COINGECKO_API_KEY:-}
      PORT: "3000"
      LOG_LEVEL: "info"
      CACHE_TTL_SECONDS: "60"
      FLUID_VAULT_RESOLVER: "0x1500D70D8551B828f8fb56fa739c977D113444Df"
      FLUID_VAULT_POSITIONS_RESOLVER: "0x91214D70b3981276Ff3b8361552D99BA41C41A7d"
      FLUID_VAULT_FACTORY: "0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d"
      TOKEN_CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"
      TOKEN_WSTETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452"
      TOKEN_USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## 14. Error Handling

| Situation | HTTP code | Behavior |
|----------|----------|-----------|
| Invalid address | 400 | Response with `error: invalid_address` |
| Base RPC timeout | 500 | Retry 2x with backoff, then 500 |
| RPC rate limit (429) | 500 | Return error with `retryAfter` |
| Decoder error (struct mismatch) | 500 | Log + 500, no crash |
| Empty nftIds array (no positions) | 200 | `positions: [], summary: zeroes` |
| Price API unavailable | 200 partial | Return positions without USD conversion, `prices: null` |

Error structure:
```json
{
  "error": "rpc_timeout",
  "message": "Base RPC did not respond within 10s",
  "retryAfter": 30
}
```

---

## 15. Developer Notes

### 15.1 Raw → Actual Amount Conversion
Fluid stores `col` and `debt` in UserPosition as **raw amounts** (without accumulated interest) when the position is in "interest mode". Before displaying:
```
actualCol  = BigInt(col)  * BigInt(supplyExchangePrice) / BigInt(1e12)
actualDebt = BigInt(debt) * BigInt(borrowExchangePrice) / BigInt(1e12)
```
If `colUnderlying` / `debtUnderlying` are present in the struct and non-zero — use them directly.

### 15.2 BigInt everywhere
All on-chain amounts are `BigInt`. Do not convert to `Number` until all math is done (overflow risk). Convert only for final JSON: `formatUnits(amount, decimals)` from viem.

### 15.3 HealthFactor
```
healthFactor = (actualCol * oraclePrice * liquidationThreshold) / actualDebt
```
All numbers in a common denominator (accounting for decimals). If `healthFactor < 1.0` → `isLiquidatable = true`.

### 15.4 Rates Precision in Fluid
Rates in Fluid = `uint256` in annualized format * 1e4 (basis points × 100). That is:
- `850000` = 85.0000% (unlikely for borrow)
- `8500` = 0.8500% more likely

**Confirm precision** with the first real eth_call: `console.log(rawRate)` and compare with the current borrow rate in the Fluid UI.

### 15.5 ABI
Take from verified contracts on Basescan or from:
`github.com/Instadapp/fluid-contracts-public` → artifacts after `forge build`.
Minimal ABIs are sufficient (only the required view methods) — not the full ABI.

### 15.6 Multicall (optimization)
To reduce the number of RPC requests: `viem.multicall()` — all getVaultEntireData calls for each vault in one eth_call. Halves the number of requests for 2+ positions.

---

## 16. Testing

### Smoke test (after deploy):
```
curl http://localhost:3000/health
curl "http://localhost:3000/positions?address=0xYOUR_ADDRESS"
```

### Unit tests:
- `conversion.ts`: tests for raw→actual with mock exchange prices
- `FluidService`: mock viem client, verify struct formatting

### Integration tests:
- Real Base RPC with testnet or fork via Foundry/Anvil
- Snapshot testing: save response and compare structure

---

## 17. Acceptance Criteria

- [ ] `GET /health` → `200 { status: "ok" }` within 2 seconds
- [ ] `GET /positions?address=0x...` → `200` with correct two positions (cbBTC/USDC and wstETH/USDC)
- [ ] Collateral and debt amounts match what Fluid UI shows (±0.01%)
- [ ] `healthFactor` > 1.0 for both positions
- [ ] `rates.supplyAPY` and `rates.borrowAPY` match current rates in Fluid UI
- [ ] `summary.totalNetValueUSD` = sum of `positions[*].netValueUSD`
- [ ] Cache: two requests in a row → second makes no eth_call (verify via logs)
- [ ] Empty RPC response → 500, no Node crash
- [ ] Docker container starts with `docker compose up -d`, healthcheck `healthy` in < 60 sec
- [ ] Response time `/positions` < 5 sec (cold), < 200 ms (from cache)

---

## 18. Useful Links

| Resource | URL |
|--------|-----|
| Fluid Tech Docs | docs.fluid.instadapp.io |
| Deployed Addresses | github.com/Instadapp/fluid-deployments |
| Contracts Source | github.com/Instadapp/fluid-contracts-public |
| Vault User Positions guide | docs.fluid.instadapp.io/integrate/vault-user-positions.html |
| Lend/Borrow Rates guide | docs.fluid.instadapp.io/integrate/lend-borrow-yield-rates.html |
| viem docs | viem.sh |
| DeFiLlama Prices API | coins.llama.fi/docs |
| Base RPC (Alchemy) | dashboard.alchemy.com |
| Basescan (Base explorer) | basescan.org |

---

**Version:** 1.0
**Date:** 2026-06-06
**Chain:** Base (chainId: 8453)
**Protocol:** Fluid by Instadapp
