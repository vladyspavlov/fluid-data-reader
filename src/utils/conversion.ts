import { formatUnits } from 'viem';

const EXCHANGE_PRICE_PRECISION = BigInt(1e12);
// Fluid stores rates as annualized * 1e6 (e.g. 8500 = 0.85%, 850000 = 85%)
// Verify with first real eth_call by logging raw values
const RATE_PRECISION = 1_000_000;
// Fluid configs (collateralFactor, liquidationThreshold) are in basis points (10000 = 100%)
const CONFIG_PRECISION = 10_000;
// Oracle price from getVaultEntireData.configs.oraclePriceOperate is col/debt in 1e27 precision
const ORACLE_PRECISION = BigInt(1e27);

export function rawToActual(raw: bigint, exchangePrice: bigint): bigint {
  return (raw * exchangePrice) / EXCHANGE_PRICE_PRECISION;
}

export function formatAmount(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

export function rateToDecimal(rawRate: bigint | number): number {
  return Number(rawRate) / RATE_PRECISION;
}

// configValue is uint16 in basis points (10000 = 100%)
export function configToDecimal(configValue: number): number {
  return configValue / CONFIG_PRECISION;
}

export function computeHealthFactor(
  colUnderlying: bigint,
  debtUnderlying: bigint,
  oraclePriceOperate: bigint,
  liquidationThreshold: number,
  colDecimals: number,
  debtDecimals: number,
): number {
  if (debtUnderlying === 0n) return Infinity;

  // Scale everything to a common 1e18 base for safe BigInt division
  const SCALE = BigInt(1e18);
  const ltScaled = BigInt(Math.round(liquidationThreshold * 1e6));

  // colValueInDebt (debt token terms) = colUnderlying * oraclePrice / 1e27 adjusted for decimals
  // oraclePriceOperate = price of 1 col unit (in debt units) * 1e27
  // We need: colValueInDebt in debtDecimals units
  // Formula: colUnderlying * oraclePriceOperate / 1e27 * 10^debtDecimals / 10^colDecimals

  const decimalAdjust = BigInt(10 ** debtDecimals) * SCALE / BigInt(10 ** colDecimals);
  const colValueInDebt = (colUnderlying * oraclePriceOperate * decimalAdjust) / ORACLE_PRECISION / SCALE;

  const hfNumerator = colValueInDebt * ltScaled;
  const hfDenominator = debtUnderlying * BigInt(1e6);

  if (hfDenominator === 0n) return Infinity;

  return Number(hfNumerator * SCALE / hfDenominator) / Number(SCALE);
}
