// Price provider abstraction. USD display is optional and never feeds reward
// accounting; when no reliable source is configured the UI shows "$-".

export interface PriceProvider {
  getSolPrice(): Promise<number | null>;
  getNvdaTokenPrice(): Promise<number | null>;
}

/**
 * CoinGecko simple-price provider. Uses PRICE_API_KEY when present.
 * Returns null (never a fabricated number) when unavailable or unconfigured.
 */
export class CoingeckoPriceProvider implements PriceProvider {
  private cache: { sol: number | null; nvda: number | null; at: number } | null = null;

  async getSolPrice(): Promise<number | null> {
    return (await this.fetchPrices()).sol;
  }

  async getNvdaTokenPrice(): Promise<number | null> {
    return (await this.fetchPrices()).nvda;
  }

  private async fetchPrices(): Promise<{ sol: number | null; nvda: number | null }> {
    if (this.cache && Date.now() - this.cache.at < 60_000) {
      return { sol: this.cache.sol, nvda: this.cache.nvda };
    }
    try {
      const key = process.env.PRICE_API_KEY;
      const headers: Record<string, string> = key ? { 'x-cg-demo-api-key': key } : {};
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { headers });
      if (!res.ok) throw new Error(`price api ${res.status}`);
      const json = (await res.json()) as { solana?: { usd?: number } };
      const sol = typeof json.solana?.usd === 'number' ? json.solana.usd : null;
      this.cache = { sol, nvda: null, at: Date.now() };
      return { sol, nvda: null };
    } catch {
      this.cache = { sol: null, nvda: null, at: Date.now() };
      return { sol: null, nvda: null };
    }
  }
}

export function getPriceProvider(): PriceProvider {
  return new CoingeckoPriceProvider();
}
