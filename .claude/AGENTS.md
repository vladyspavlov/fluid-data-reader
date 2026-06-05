# AGENTS.md — Multi-Agent Configuration

## Agent Roles

### 1. `backend` — Implementation Agent
**Model:** `claude-sonnet-4-6`
**Scope:** Full service implementation

**Responsibilities:**
- Project scaffold (`package.json`, `tsconfig.json`, `Dockerfile`, `docker-compose.yml`)
- `src/services/FluidService.ts` — on-chain logic (viem, resolver calls, BigInt math)
- `src/services/PriceService.ts` — DeFiLlama / CoinGecko integration
- `src/services/CacheService.ts` — TTL in-memory cache
- `src/utils/conversion.ts` — raw→actual amount helpers
- `src/config/contracts.ts` — contract addresses from .env
- `src/routes/positions.ts` — Express handlers
- `src/index.ts` — app entry point
- `.env.example`

**Constraints:**
- Read CLAUDE.md before each session
- Save SESSION_STATE.md at CHECKPOINT (75% context)
- BigInt everywhere, `viem.formatUnits` only for JSON output
- Multicall for batch vault data

---

### 2. `review` — Code Review Agent
**Model:** `claude-opus-4-8`
**Scope:** Code review after each module is complete

**Responsibilities:**
- BigInt safety (overflow, premature conversion)
- RAW→actual conversion (precision 1e12)
- ABI alignment with real contracts
- Error handling completeness (all cases from the table in CLAUDE.md)
- Security review (env vars, no private keys, no secrets in logs)
- Performance (multicall used, cache keyed correctly)
- TypeScript type correctness
- Acceptance criteria coverage

**Output format:**
```
## Review: [module_name]
### ✅ OK
- ...
### ⚠️ Warnings
- ...
### ❌ Must Fix
- ...
```

---

### 3. `researcher` — Optional Research Agent
**Model:** `claude-sonnet-4-6`
**Scope:** On-demand for resolving blockers

**Triggers (when to invoke):**
- Need to verify ABI methods of resolver contracts
- Rates precision confirmation
- NFT ID discovery method fallback logic
- DeFiLlama API response format

---

## Workflow

```
1. backend → scaffold + FluidService (CHECKPOINT after each file > 200 lines)
2. review  → review FluidService
3. backend → fix review comments
4. backend → PriceService + CacheService + routes
5. review  → final full review
6. backend → Dockerfile + docker-compose + README
```

---

## Launching Agents in Claude Code

### Backend agent:
```bash
claude --model claude-sonnet-4-6 \
  "Read CLAUDE.md and SESSION_STATE.md (if exists), then implement FluidService.ts"
```

### Review agent:
```bash
claude --model claude-opus-4-8 \
  "Read CLAUDE.md, then review src/services/FluidService.ts against the spec in docs/spec.md"
```

### Resuming after CHECKPOINT:
```bash
claude --model claude-sonnet-4-6 \
  "Read CLAUDE.md and SESSION_STATE.md, then continue from where you left off"
```

---

## Context Persistence Rules (all agents)

1. **75% context** → write `SESSION_STATE.md`, output `CHECKPOINT SAVED`
2. Before any `Task` subagent — pass `SESSION_STATE.md` as context
3. After `review` — the review agent ALSO updates `SESSION_STATE.md` with its findings
4. `SESSION_STATE.md` — single source of truth between sessions

## Subagent orchestration (Claude Code Task tool)

When using Claude Code orchestrator, pass to each subagent:
```
context_files: ["CLAUDE.md", "SESSION_STATE.md", "docs/spec.md"]
```
