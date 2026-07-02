// Port de universe.py + data_fetcher.py + fundamental_filter.py
// Toute la pile tourne dans le navigateur: appels directs a Binance,
// CoinGecko et alternative.me (CORS ouvert sur les trois).

const WATCHLIST_CACHE_KEY = "signaltrade_watchlist_v1";
const WATCHLIST_CACHE_TTL_MS = 24 * 3600 * 1000;
const VALID_TICKER = /^[A-Z0-9]+$/;

async function fetchTopSymbols(limit = CONFIG.watchlistSize) {
  const stableResp = await fetch(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=stablecoins&per_page=250"
  );
  const stableIds = new Set((await stableResp.json()).map((c) => c.id));

  const marketsResp = await fetch(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250"
  );
  const markets = await marketsResp.json();
  const candidates = markets.filter((c) => !stableIds.has(c.id));

  const exchangeInfoResp = await fetch("https://api.binance.com/api/v3/exchangeInfo");
  const exchangeInfo = await exchangeInfoResp.json();
  const validBaseAssets = new Set(
    exchangeInfo.symbols
      .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING")
      .map((s) => s.baseAsset)
  );

  const result = [];
  for (const coin of candidates) {
    const ticker = coin.symbol.toUpperCase();
    if (VALID_TICKER.test(ticker) && validBaseAssets.has(ticker) && !result.includes(ticker)) {
      result.push(ticker);
      if (result.length >= limit) break;
    }
  }
  return result.map((t) => `${t}USDT`);
}

async function getWatchlist(limit = CONFIG.watchlistSize) {
  const cached = localStorage.getItem(WATCHLIST_CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed.limit === limit && Date.now() - parsed.fetchedAt < WATCHLIST_CACHE_TTL_MS) {
      return parsed.symbols;
    }
  }

  try {
    const symbols = await fetchTopSymbols(limit);
    localStorage.setItem(WATCHLIST_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), limit, symbols }));
    return symbols;
  } catch (e) {
    if (cached) return JSON.parse(cached).symbols;
    throw e;
  }
}

async function fetchKlines(symbol, interval = CONFIG.timeframe, limit = CONFIG.candlesHistory) {
  const resp = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  if (!resp.ok) throw new Error(`Binance klines ${symbol}: HTTP ${resp.status}`);
  const raw = await resp.json();
  return raw.map((k) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

async function fetchFundamentals() {
  try {
    const [globalResp, fngResp] = await Promise.all([
      fetch("https://api.coingecko.com/api/v3/global"),
      fetch("https://api.alternative.me/fng/?limit=1"),
    ]);
    const globalData = await globalResp.json();
    const fngData = await fngResp.json();
    return {
      btcDominance: globalData.data.market_cap_percentage.btc,
      fearGreed: {
        value: parseInt(fngData.data[0].value, 10),
        classification: fngData.data[0].value_classification,
      },
    };
  } catch (e) {
    return { btcDominance: null, fearGreed: null };
  }
}
