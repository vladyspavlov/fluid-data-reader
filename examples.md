# API Usage Examples

Base URL: `http://your-server:3001`

---

## Health Check

### curl
```bash
curl http://localhost:3001/health
```

```json
{ "status": "ok", "timestamp": "2026-06-06T11:00:00.000Z" }
```

---

## Get Positions

### curl — GET
```bash
curl "http://localhost:3001/positions?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
```

### curl — POST
```bash
curl -X POST http://localhost:3001/positions \
  -H "Content-Type: application/json" \
  -d '{"address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"}'
```

### curl — pretty print
```bash
curl -s "http://localhost:3001/positions?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" | jq
```

---

## JavaScript / TypeScript (fetch)

```ts
const BASE_URL = 'http://localhost:3001';

async function getPositions(address: string) {
  const res = await fetch(`${BASE_URL}/positions?address=${address}`);

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`${err.error}: ${err.message}`);
  }

  return res.json();
}

const data = await getPositions('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');

console.log(`Total net value: $${data.summary.totalNetValueUSD}`);

for (const pos of data.positions) {
  console.log(`NFT #${pos.nftId} — ${pos.collateral.token}/${pos.debt.token}`);
  console.log(`  Collateral: ${pos.collateral.amount} ${pos.collateral.token} ($${pos.collateral.valueUSD})`);
  console.log(`  Debt:       ${pos.debt.amount} ${pos.debt.token} ($${pos.debt.valueUSD})`);
  console.log(`  Health:     ${pos.health.healthFactor.toFixed(2)}`);
  console.log(`  Borrow APY: ${(pos.rates.borrowAPY * 100).toFixed(2)}%`);
}
```

---

## Python

```python
import requests

BASE_URL = 'http://localhost:3001'

def get_positions(address: str) -> dict:
    res = requests.get(f'{BASE_URL}/positions', params={'address': address})
    res.raise_for_status()
    return res.json()

data = get_positions('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

print(f"Total net value: ${data['summary']['totalNetValueUSD']:,.2f}")

for pos in data['positions']:
    col = pos['collateral']
    debt = pos['debt']
    health = pos['health']
    print(f"\nNFT #{pos['nftId']} — {col['token']}/{debt['token']}")
    print(f"  Collateral:  {col['amount']} {col['token']}  (${col['valueUSD']:,.2f})")
    print(f"  Debt:        {debt['amount']} {debt['token']}  (${debt['valueUSD']:,.2f})")
    print(f"  Net value:   ${pos['netValueUSD']:,.2f}")
    print(f"  Health factor: {health['healthFactor']:.2f}")
    print(f"  Liquidatable:  {health['isLiquidatable']}")
```

---

## Google Apps Script

```javascript
const FLUID_API = 'http://your-server:3001';
const WALLET   = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

function getFluidPositions() {
  const url = `${FLUID_API}/positions?address=${WALLET}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (res.getResponseCode() !== 200) {
    const err = JSON.parse(res.getContentText());
    throw new Error(`Fluid API error: ${err.message}`);
  }

  return JSON.parse(res.getContentText());
}

/** Write summary row to the active sheet */
function writeSummaryToSheet() {
  const data    = getFluidPositions();
  const summary = data.summary;
  const prices  = data.prices;
  const sheet   = SpreadsheetApp.getActiveSheet();

  sheet.getRange('A1').setValue('Updated');
  sheet.getRange('B1').setValue(new Date(data.timestamp));

  sheet.getRange('A2').setValue('Total Collateral USD');
  sheet.getRange('B2').setValue(summary.totalCollateralUSD);

  sheet.getRange('A3').setValue('Total Debt USD');
  sheet.getRange('B3').setValue(summary.totalDebtUSD);

  sheet.getRange('A4').setValue('Net Value USD');
  sheet.getRange('B4').setValue(summary.totalNetValueUSD);

  sheet.getRange('A5').setValue('Net Value BTC');
  sheet.getRange('B5').setValue(summary.totalNetValueBTC);

  sheet.getRange('A6').setValue('Net Value ETH');
  sheet.getRange('B6').setValue(summary.totalNetValueETH);

  sheet.getRange('A8').setValue('BTC/USD');
  sheet.getRange('B8').setValue(prices?.BTC_USD ?? 'N/A');

  sheet.getRange('A9').setValue('ETH/USD');
  sheet.getRange('B9').setValue(prices?.ETH_USD ?? 'N/A');

  // Per-position rows starting at row 11
  let row = 11;
  sheet.getRange(row, 1, 1, 7).setValues([[
    'NFT ID', 'Vault type', 'Collateral', 'Col USD', 'Debt USD', 'Health', 'Borrow APY'
  ]]);
  row++;

  for (const pos of data.positions) {
    sheet.getRange(row, 1, 1, 7).setValues([[
      pos.nftId,
      `${pos.collateral.token}/${pos.debt.token}`,
      `${pos.collateral.amount} ${pos.collateral.token}`,
      pos.collateral.valueUSD,
      pos.debt.valueUSD,
      pos.health.healthFactor,
      pos.rates.borrowAPY,
    ]]);
    row++;
  }
}
```

---

## Error Handling

```ts
async function getPositionsSafe(address: string) {
  const res = await fetch(`http://localhost:3001/positions?address=${address}`);
  const body = await res.json();

  if (!res.ok) {
    switch (body.error) {
      case 'invalid_address':
        console.error('Bad address:', address);
        break;
      case 'rpc_timeout':
        console.error('RPC timed out, retry after', body.retryAfter, 's');
        break;
      case 'rpc_rate_limit':
        console.error('Rate limited, retry after', body.retryAfter, 's');
        break;
      default:
        console.error('Unexpected error:', body.message);
    }
    return null;
  }

  // Prices can be null even on success (price APIs down)
  if (!body.prices) {
    console.warn('Prices unavailable — USD values will be null');
  }

  return body;
}
```

---

## Polling (refresh every 60 s)

```ts
async function poll(address: string, intervalMs = 60_000) {
  async function tick() {
    const data = await getPositionsSafe(address);
    if (data) {
      console.log(`[${data.timestamp}] Net: $${data.summary.totalNetValueUSD}`);
    }
  }

  await tick();
  setInterval(tick, intervalMs);
}

poll('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
```
