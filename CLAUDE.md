# CLAUDE.md — Fluid Node Service

> Full specification: `docs/spec.md` — read when working on business logic and on-chain details.

---

## Workflow Rules

- **Code review before every commit:** Run `/code-review` on changed files and fix all `❌ Must Fix` issues before committing.
- **Never add Claude as co-author** in commit messages.
- **Agent configs** live in `.claude/` (e.g. `.claude/AGENTS.md`), not in `docs/`.

---

## Project

Autonomous microservice (Node.js + Docker) for reading DeFi positions from Fluid Protocol on Base (chainId: 8453) via on-chain resolver contracts. Provides a REST JSON API for consumption from Google Apps Script or any HTTP client. The service is **read-only** — no transactions, no private keys.

---

## Tech Stack

| | |
|---|---|
| Runtime | Node.js 24 LTS |
| HTTP | Express.js 5.x |
| Web3 | viem 2.x |
| Language | TypeScript |
| Docker | node:24-alpine |
| Cache | In-memory Map, TTL=60s |
| Prices | DeFiLlama `coins.llama.fi/prices/current/` (primary), CoinGecko (fallback) |

---

## Project Structure

```
fluid-data-reader/
├── src/
│   ├── index.ts
│   ├── routes/positions.ts
│   ├── services/
│   │   ├── FluidService.ts
│   │   ├── PriceService.ts
│   │   └── CacheService.ts
│   ├── abi/
│   │   ├── FluidVaultResolver.json
│   │   ├── FluidVaultPositionsResolver.json
│   │   └── FluidVaultFactory.json
│   ├── config/contracts.ts
│   └── utils/conversion.ts
├── docs/
│   ├── spec.md            ← full specification
│   └── AGENTS.md          ← agent roles
├── SESSION_STATE.md        ← current session state (auto-updated)
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── CLAUDE.md
```

---

## API Endpoints

- `GET /health` → `{ status: "ok", timestamp }`
- `GET /positions?address=0x...` or `POST /positions { address }`
- Response schema: positions[] with collateral/debt/rates/health + summary

---

## Critical Technical Rules

### 1. BigInt everywhere
All on-chain amounts are BigInt until the very end. Convert to Number ONLY for the final JSON via `viem.formatUnits(amount, decimals)`. Violation → silent overflow.

### 2. RAW → Actual conversion
```
actualCol  = BigInt(col)  * BigInt(supplyExchangePrice) / BigInt(1e12)
actualDebt = BigInt(debt) * BigInt(borrowExchangePrice) / BigInt(1e12)
```
If `colUnderlying` / `debtUnderlying` are non-zero in UserPosition → use them directly (Fluid v2+).

### 3. HealthFactor
```
healthFactor = (actualCol * oraclePrice * liquidationThreshold) / actualDebt
```
`healthFactor < 1.0` → `isLiquidatable = true`

### 4. Rates precision — VERIFY
Rates in Fluid: `uint256` * 1e4 (basis points × 100). `8500` = 0.85%, `850000` = 85%. Confirm with first real eth_call.

### 5. ABI sources
- `github.com/Instadapp/fluid-contracts-public` → artifacts
- Or Basescan (basescan.org) for deployed addresses
- DO NOT hardcode addresses without verification

### 6. NFT ID discovery — method priority
1. `FluidVaultFactory.getUserNfts(address)` → `uint256[]`
2. Fallback: `FluidVaultPositionsResolver.getAllPositionsByUser(address)`
3. Fallback: `ERC721.tokensOfOwner(address)` on VaultFactory

### 7. Multicall
`viem.multicall()` for `getVaultEntireData` across all vaults simultaneously — required to reduce RPC requests.

### 8. Error handling
| Situation | Code |
|---|---|
| Invalid address | 400 `invalid_address` |
| RPC timeout (retry 2x backoff) | 500 `rpc_timeout` |
| Struct decode error | 500, no crash |
| Empty nftIds | 200 `positions: []` |
| Price API down | 200 partial, `prices: null` |

### 9. Use built-in methods
Use built-in Node.js and library methods; write additional code only when there is no other way to implement something.

---

## Environment Variables

```dotenv
BASE_RPC_URL=          # Alchemy or another Base RPC (required)
PORT=3000
FLUID_VAULT_RESOLVER=
FLUID_VAULT_POSITIONS_RESOLVER=
FLUID_VAULT_FACTORY=
TOKEN_CBBTC=0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf
TOKEN_WSTETH=0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452
TOKEN_USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
CACHE_TTL_SECONDS=60
COINGECKO_API_KEY=     # optional
LOG_LEVEL=info
```

---

## Acceptance Criteria (Definition of Done)

- [ ] `GET /health` → 200 in < 2s
- [ ] `GET /positions?address=` → correct cbBTC/USDC and wstETH/USDC positions
- [ ] Amounts match Fluid UI (±0.01%)
- [ ] `healthFactor > 1.0` for both positions
- [ ] Rates match current rates in Fluid UI
- [ ] `summary.totalNetValueUSD` = sum of `positions[*].netValueUSD`
- [ ] Second consecutive request makes no eth_call (log confirmation)
- [ ] RPC error → 500, no crash
- [ ] `docker compose up -d` → healthcheck `healthy` in < 60s
- [ ] Cold response < 5s, cached < 200ms

---

## Context Persistence Protocol

**IMPORTANT for all agents:**

When the context window is approximately **75% full** (or on explicit `CHECKPOINT` command), before stopping the agent must:

1. Write the current state to `SESSION_STATE.md` using the template below
2. Output: `"CHECKPOINT SAVED → SESSION_STATE.md"`
3. Only then stop or hand off control

**SESSION_STATE.md template:**
```markdown
# SESSION_STATE — [AGENT_ROLE] — [ISO_TIMESTAMP]

## Completed
- [list of completed tasks with files]

## Current Task
[description of the task in progress]

## Current File
[path to file, line where we stopped]

## Key Decisions Made
- [decisions made during the session]

## Open Questions / Blockers
- [questions that need answers]

## Next Steps (ordered)
1. [next task]
2. ...

## File Checksums / State
[which files were created/modified]
```

**Resuming a new session:** start with `Read SESSION_STATE.md and docs/spec.md, then continue.`
