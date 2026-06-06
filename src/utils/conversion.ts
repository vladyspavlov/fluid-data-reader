import { formatUnits } from 'viem';

// Fluid oracle price: price of 1 unit of collateral expressed in debt token units, scaled by 1e27.
// The oracle already accounts for the decimal difference between collateral and debt tokens.
const ORACLE_PRECISION = 10n ** 27n;

// Fluid stores annualized rates as integer * 10000 (e.g. 659 = 6.59%)
// Verified from on-chain data: borrowRateVault=659 matches UI's 6.59% borrow APY.
const RATE_PRECISION = 10_000;

// Fluid configs (collateralFactor, liquidationThreshold) are uint16 in basis points (10000 = 100%)
const CONFIG_PRECISION = 10_000;

export function formatAmount(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

export function rateToDecimal(rawRate: bigint | number): number {
  return Number(rawRate) / RATE_PRECISION;
}

export function configToDecimal(configValue: number): number {
  return configValue / CONFIG_PRECISION;
}

export function computeHealthFactor(
  colUnderlying: bigint,
  debtUnderlying: bigint,
  oraclePriceOperate: bigint,
  liquidationThreshold: number,
): number {
  if (debtUnderlying === 0n) return Infinity;

  // Oracle price already converts col units → debt units at 1e27 scale.
  // No additional decimal adjustment needed.
  const colValueInDebt = (colUnderlying * oraclePriceOperate) / ORACLE_PRECISION;

  if (colValueInDebt === 0n) return 0;

  const SCALE = 1_000_000n;
  const ltScaled = BigInt(Math.round(liquidationThreshold * Number(SCALE)));

  const hfScaled = (colValueInDebt * ltScaled) / debtUnderlying;
  return Number(hfScaled) / Number(SCALE);
}
