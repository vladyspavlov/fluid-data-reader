import { createPublicClient, http, formatUnits, type Address, type Abi } from 'viem';
import { base } from 'viem/chains';
import { contracts } from '../config/contracts.js';
import { rateToDecimal, configToDecimal, computeHealthFactor } from '../utils/conversion.js';
import { CacheService } from './CacheService.js';
import { PriceService, type Prices } from './PriceService.js';
import { config } from '../config/contracts.js';

import FluidVaultFactoryAbi from '../abi/FluidVaultFactory.json' with { type: 'json' };
import FluidVaultPositionsResolverAbi from '../abi/FluidVaultPositionsResolver.json' with { type: 'json' };
import FluidVaultResolverAbi from '../abi/FluidVaultResolver.json' with { type: 'json' };

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const ERC20_ABI = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
] as const satisfies Abi;

interface TokenMeta {
  symbol: string;
  decimals: number;
}

interface VaultData {
  constantVariables: {
    supply: Address;
    borrow: Address;
    supplyToken: { token0: Address; token1: Address };
    borrowToken: { token0: Address; token1: Address };
  };
  configs: {
    collateralFactor: number;
    liquidationThreshold: number;
    oraclePriceOperate: bigint;
  };
  exchangePricesAndRates: {
    vaultSupplyExchangePrice: bigint;
    vaultBorrowExchangePrice: bigint;
    supplyRateVault: bigint;
    borrowRateVault: bigint;
  };
}

// Actual 4-field struct returned by getPositionsForNftIds (verified from raw eth_call)
type UserPosition = {
  nftId: bigint;
  owner: string;
  col: bigint;   // underlying collateral amount (native token units)
  debt: bigint;  // underlying debt amount (native token units)
};

export interface PositionResponse {
  address: string;
  chain: 'base';
  timestamp: string;
  positions: Position[];
  summary: Summary;
  prices: Prices | null;
}

interface Position {
  nftId: string;
  vault: string;
  collateral: TokenAmount;
  debt: TokenAmount;
  rates: Rates;
  health: Health;
  netValueUSD: number | null;
  netValueETH: number | null;
  netValueBTC: number | null;
}

interface TokenAmount {
  token: string;
  tokenAddress: string;
  decimals: number;
  amountRaw: string;
  amount: string;
  valueUSD: number | null;
}

interface Rates {
  supplyAPY: number;
  borrowAPY: number;
  netAPY: number;
}

interface Health {
  collateralFactor: number;
  liquidationThreshold: number;
  healthFactor: number;
  isLiquidatable: boolean;
}

interface Summary {
  totalCollateralUSD: number | null;
  totalDebtUSD: number | null;
  totalNetValueUSD: number | null;
  totalNetValueETH: number | null;
  totalNetValueBTC: number | null;
  weightedSupplyAPY: number;
  weightedBorrowAPY: number;
}

export class FluidService {
  private readonly client = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl, {
      retryCount: 2,
      retryDelay: 2000,
      timeout: 10_000,
    }),
    batch: { multicall: true },
  });

  private readonly cache = new CacheService<PositionResponse>(config.cacheTtlSeconds);
  private readonly priceService = new PriceService();
  private readonly tokenMetaCache = new Map<Address, TokenMeta>();

  async getPositions(address: Address): Promise<PositionResponse> {
    const cacheKey = address.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.info(`[FluidService] cache hit for ${address}`);
      return cached;
    }

    console.info(`[FluidService] fetching positions for ${address}`);
    const result = await this.fetchPositions(address);
    this.cache.set(cacheKey, result);
    return result;
  }

  private async fetchPositions(address: Address): Promise<PositionResponse> {
    const nftIds = await this.getNftIds(address);

    if (nftIds.length === 0) {
      const prices = await this.priceService.getPrices();
      return this.buildEmptyResponse(address, prices);
    }

    // Fetch positions, vault addresses per nftId, and prices in parallel
    const [userPositions, vaultAddresses, prices] = await Promise.all([
      this.getUserPositions(nftIds),
      this.getVaultAddresses(nftIds),
      this.priceService.getPrices(),
    ]);

    const uniqueVaults = [...new Set(vaultAddresses)];
    const vaultDataMap = await this.getVaultDataMap(uniqueVaults);

    const positions = await Promise.all(
      userPositions.map((pos, i) => this.buildPosition(pos, vaultAddresses[i], vaultDataMap, prices)),
    );

    return {
      address,
      chain: 'base',
      timestamp: new Date().toISOString(),
      positions,
      summary: this.buildSummary(positions, prices),
      prices,
    };
  }

  private async getNftIds(address: Address): Promise<readonly bigint[]> {
    try {
      return (await this.client.readContract({
        address: contracts.vaultFactory,
        abi: FluidVaultFactoryAbi as Abi,
        functionName: 'getUserNfts',
        args: [address],
      })) as bigint[];
    } catch (err) {
      console.error('[FluidService] getUserNfts failed, trying fallback:', err);
      return this.getNftIdsFallback(address);
    }
  }

  private async getNftIdsFallback(address: Address): Promise<readonly bigint[]> {
    // Fallback: ERC721 enumerable — balanceOf + tokenOfOwnerByIndex
    const balance = (await this.client.readContract({
      address: contracts.vaultFactory,
      abi: FluidVaultFactoryAbi as Abi,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint;

    if (balance === 0n) return [];

    const indices = Array.from({ length: Number(balance) }, (_, i) => BigInt(i));
    const nftIds = await Promise.all(
      indices.map((index) =>
        this.client.readContract({
          address: contracts.vaultFactory,
          abi: FluidVaultFactoryAbi as Abi,
          functionName: 'tokenOfOwnerByIndex',
          args: [address, index],
        }) as Promise<bigint>,
      ),
    );

    console.info(`[FluidService] ERC721 fallback found ${nftIds.length} NFTs for ${address}`);
    return nftIds;
  }

  private async getUserPositions(nftIds: readonly bigint[]): Promise<UserPosition[]> {
    return (await this.client.readContract({
      address: contracts.vaultPositionsResolver,
      abi: FluidVaultPositionsResolverAbi as Abi,
      functionName: 'getPositionsForNftIds',
      args: [nftIds],
    })) as UserPosition[];
  }

  private async getVaultAddresses(nftIds: readonly bigint[]): Promise<Address[]> {
    return Promise.all(
      nftIds.map((nftId) =>
        this.client.readContract({
          address: contracts.vaultFactory,
          abi: FluidVaultFactoryAbi as Abi,
          functionName: 'getVaultAddress',
          args: [nftId],
        }) as Promise<Address>,
      ),
    );
  }

  private async getVaultDataMap(vaultAddresses: Address[]): Promise<Map<string, VaultData>> {
    // Promise.all batches into a single multicall because client is configured with batch.multicall
    const results = await Promise.all(
      vaultAddresses.map((vault) =>
        this.client.readContract({
          address: contracts.vaultResolver,
          abi: FluidVaultResolverAbi as Abi,
          functionName: 'getVaultEntireData',
          args: [vault],
        }),
      ),
    );

    const map = new Map<string, VaultData>();
    vaultAddresses.forEach((vault, i) => map.set(vault.toLowerCase(), results[i] as VaultData));
    return map;
  }

  private async getTokenMeta(tokenAddress: Address): Promise<TokenMeta> {
    const cached = this.tokenMetaCache.get(tokenAddress);
    if (cached) return cached;

    const [symbol, decimals] = (await this.client.multicall({
      contracts: [
        { address: tokenAddress, abi: ERC20_ABI, functionName: 'symbol' },
        { address: tokenAddress, abi: ERC20_ABI, functionName: 'decimals' },
      ],
      allowFailure: false,
    })) as [string, number];

    const meta = { symbol, decimals };
    this.tokenMetaCache.set(tokenAddress, meta);
    return meta;
  }

  private async buildPosition(
    pos: UserPosition,
    vault: Address,
    vaultDataMap: Map<string, VaultData>,
    prices: Prices | null,
  ): Promise<Position> {
    const vaultData = vaultDataMap.get(vault.toLowerCase());
    if (!vaultData) throw new Error(`No vault data for ${vault}`);

    const colTokenAddress = vaultData.constantVariables.supply !== ZERO_ADDRESS
      ? vaultData.constantVariables.supply
      : vaultData.constantVariables.supplyToken.token0;

    const debtTokenAddress = vaultData.constantVariables.borrow !== ZERO_ADDRESS
      ? vaultData.constantVariables.borrow
      : vaultData.constantVariables.borrowToken.token0;

    const [colMeta, debtMeta] = await Promise.all([
      this.getTokenMeta(colTokenAddress),
      this.getTokenMeta(debtTokenAddress),
    ]);

    // col and debt from the resolver are already underlying (actual) amounts
    const actualCol = pos.col;
    const actualDebt = pos.debt;

    const colAmountStr = formatUnits(actualCol, colMeta.decimals);
    const debtAmountStr = formatUnits(actualDebt, debtMeta.decimals);

    const colAmount = parseFloat(colAmountStr);
    const debtAmount = parseFloat(debtAmountStr);

    const colValueUSD = prices ? colAmount * this.getTokenUSD(colMeta.symbol, prices) : null;
    const debtValueUSD = prices ? debtAmount * this.getTokenUSD(debtMeta.symbol, prices) : null;

    const liquidationThreshold = configToDecimal(vaultData.configs.liquidationThreshold);
    const collateralFactor = configToDecimal(vaultData.configs.collateralFactor);

    const healthFactor = computeHealthFactor(
      actualCol,
      actualDebt,
      vaultData.configs.oraclePriceOperate,
      liquidationThreshold,
      colMeta.decimals,
      debtMeta.decimals,
    );

    const supplyAPY = rateToDecimal(vaultData.exchangePricesAndRates.supplyRateVault);
    const borrowAPY = rateToDecimal(vaultData.exchangePricesAndRates.borrowRateVault);

    const netValueUSD = colValueUSD !== null && debtValueUSD !== null
      ? colValueUSD - debtValueUSD
      : null;

    const ETH_USD = prices?.ETH_USD ?? null;
    const BTC_USD = prices?.BTC_USD ?? null;

    return {
      nftId: pos.nftId.toString(),
      vault,
      collateral: {
        token: colMeta.symbol,
        tokenAddress: colTokenAddress,
        decimals: colMeta.decimals,
        amountRaw: actualCol.toString(),
        amount: colAmountStr,
        valueUSD: colValueUSD,
      },
      debt: {
        token: debtMeta.symbol,
        tokenAddress: debtTokenAddress,
        decimals: debtMeta.decimals,
        amountRaw: actualDebt.toString(),
        amount: debtAmountStr,
        valueUSD: debtValueUSD,
      },
      rates: {
        supplyAPY,
        borrowAPY,
        netAPY: supplyAPY - borrowAPY,
      },
      health: {
        collateralFactor,
        liquidationThreshold,
        healthFactor: isFinite(healthFactor) ? healthFactor : 999,
        isLiquidatable: isFinite(healthFactor) && healthFactor < 1.0,
      },
      netValueUSD,
      netValueETH: netValueUSD !== null && ETH_USD ? netValueUSD / ETH_USD : null,
      netValueBTC: netValueUSD !== null && BTC_USD ? netValueUSD / BTC_USD : null,
    };
  }

  private getTokenUSD(symbol: string, prices: Prices): number {
    switch (symbol.toLowerCase()) {
      case 'cbbtc': return prices.cbBTC_USD;
      case 'wsteth': return prices.wstETH_USD;
      case 'usdc': return prices.USDC_USD;
      case 'weth':
      case 'eth': return prices.ETH_USD;
      case 'btc':
      case 'wbtc': return prices.BTC_USD;
      default:
        console.warn(`[FluidService] Unknown token symbol: ${symbol}, price defaulting to 0`);
        return 0;
    }
  }

  private buildSummary(positions: Position[], prices: Prices | null): Summary {
    const withPrices = prices !== null;
    let totalCollateralUSD = 0;
    let totalDebtUSD = 0;
    let totalNetValueUSD = 0;
    let weightedSupplyAPY = 0;
    let weightedBorrowAPY = 0;

    for (const p of positions) {
      totalCollateralUSD += p.collateral.valueUSD ?? 0;
      totalDebtUSD += p.debt.valueUSD ?? 0;
      totalNetValueUSD += p.netValueUSD ?? 0;
      weightedSupplyAPY += p.rates.supplyAPY * (p.collateral.valueUSD ?? 0);
      weightedBorrowAPY += p.rates.borrowAPY * (p.debt.valueUSD ?? 0);
    }

    if (totalCollateralUSD > 0) weightedSupplyAPY /= totalCollateralUSD;
    if (totalDebtUSD > 0) weightedBorrowAPY /= totalDebtUSD;

    const ETH_USD = prices?.ETH_USD ?? null;
    const BTC_USD = prices?.BTC_USD ?? null;

    return {
      totalCollateralUSD: withPrices ? totalCollateralUSD : null,
      totalDebtUSD: withPrices ? totalDebtUSD : null,
      totalNetValueUSD: withPrices ? totalNetValueUSD : null,
      totalNetValueETH: withPrices && ETH_USD ? totalNetValueUSD / ETH_USD : null,
      totalNetValueBTC: withPrices && BTC_USD ? totalNetValueUSD / BTC_USD : null,
      weightedSupplyAPY,
      weightedBorrowAPY,
    };
  }

  private buildEmptyResponse(address: Address, prices: Prices | null): PositionResponse {
    return {
      address,
      chain: 'base',
      timestamp: new Date().toISOString(),
      positions: [],
      summary: {
        totalCollateralUSD: 0,
        totalDebtUSD: 0,
        totalNetValueUSD: 0,
        totalNetValueETH: 0,
        totalNetValueBTC: 0,
        weightedSupplyAPY: 0,
        weightedBorrowAPY: 0,
      },
      prices,
    };
  }
}
