import { tokens } from '../config/contracts.js';
import { config } from '../config/contracts.js';

export interface Prices {
  ETH_USD: number;
  BTC_USD: number;
  cbBTC_USD: number;
  wstETH_USD: number;
  USDC_USD: number;
}

interface LlamaResponse {
  coins: Record<string, { price: number; decimals?: number; symbol?: string }>;
}

const LLAMA_BASE_URL = 'https://coins.llama.fi/prices/current';

// coingecko IDs for fallback
const COINGECKO_IDS: Record<string, string> = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  cbbtc: 'coinbase-wrapped-btc',
  wsteth: 'wrapped-steth',
};

export class PriceService {
  async getPrices(): Promise<Prices | null> {
    try {
      return await this.fetchFromLlama();
    } catch (err) {
      console.error('[PriceService] DeFiLlama failed, trying CoinGecko:', err);
      try {
        return await this.fetchFromCoinGecko();
      } catch (err2) {
        console.error('[PriceService] CoinGecko also failed:', err2);
        return null;
      }
    }
  }

  private async fetchFromLlama(): Promise<Prices> {
    const keys = [
      `base:${tokens.cbBTC}`,
      `base:${tokens.wstETH}`,
      `base:${tokens.USDC}`,
      'coingecko:bitcoin',
      'coingecko:ethereum',
    ].join(',');

    const url = `${LLAMA_BASE_URL}/${keys}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

    const data = (await res.json()) as LlamaResponse;
    const c = data.coins;

    const cbBTC_USD = c[`base:${tokens.cbBTC}`]?.price;
    const wstETH_USD = c[`base:${tokens.wstETH}`]?.price;
    const USDC_USD = c[`base:${tokens.USDC}`]?.price ?? 1;
    const BTC_USD = c['coingecko:bitcoin']?.price;
    const ETH_USD = c['coingecko:ethereum']?.price;

    if (!cbBTC_USD || !wstETH_USD || !BTC_USD || !ETH_USD) {
      throw new Error('DeFiLlama missing required price fields');
    }

    return { ETH_USD, BTC_USD, cbBTC_USD, wstETH_USD, USDC_USD };
  }

  private async fetchFromCoinGecko(): Promise<Prices> {
    const ids = 'bitcoin,ethereum,coinbase-wrapped-btc,wrapped-steth,usd-coin';
    const url = new URL('https://api.coingecko.com/api/v3/simple/price');
    url.searchParams.set('ids', ids);
    url.searchParams.set('vs_currencies', 'usd');
    if (config.coingeckoApiKey) {
      url.searchParams.set('x_cg_demo_api_key', config.coingeckoApiKey);
    }

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const data = (await res.json()) as Record<string, { usd: number }>;

    return {
      BTC_USD: data.bitcoin.usd,
      ETH_USD: data.ethereum.usd,
      cbBTC_USD: data['coinbase-wrapped-btc'].usd,
      wstETH_USD: data['wrapped-steth'].usd,
      USDC_USD: data['usd-coin']?.usd ?? 1,
    };
  }
}
