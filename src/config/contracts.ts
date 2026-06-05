import { type Address } from 'viem';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const contracts = {
  vaultResolver: requireEnv('FLUID_VAULT_RESOLVER') as Address,
  vaultPositionsResolver: requireEnv('FLUID_VAULT_POSITIONS_RESOLVER') as Address,
  vaultFactory: requireEnv('FLUID_VAULT_FACTORY') as Address,
};

export const tokens = {
  cbBTC: (process.env.TOKEN_CBBTC ?? '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf') as Address,
  wstETH: (process.env.TOKEN_WSTETH ?? '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452') as Address,
  USDC: (process.env.TOKEN_USDC ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') as Address,
};

export const config = {
  rpcUrl: requireEnv('BASE_RPC_URL'),
  port: parseInt(process.env.PORT ?? '3000', 10),
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS ?? '60', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  coingeckoApiKey: process.env.COINGECKO_API_KEY ?? '',
};
