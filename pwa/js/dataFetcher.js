// Port de universe.py + data_fetcher.py + fundamental_filter.py
// Toute la pile tourne dans le navigateur: appels directs a Binance,
// CoinGecko, alternative.me et Hyperliquid (CORS ouvert sur les quatre).
//
// Deux venues possibles par actif:
// - "binance": priorite, paire XXXUSDT, klines classiques.
// - "hyperliquid": repli pour les actifs top 100 par capitalisation absents
//   de Binance (ex: HYPE) - candleSnapshot journalier avec volume, meme
//   qualite de donnee que Binance (contrairement a l'endpoint OHLC gratuit
//   de CoinGecko, limite a des bougies de 4 jours sans volume au-dela de
//   30 jours d'historique). Le "top 100" reste toujours pilote par le
//   classement CoinGecko: Hyperliquid ne fait que fournir le prix pour les
//   actifs deja retenus, il n'ajoute jamais un actif qui n'y figurerait pas.

const WATCHLIST_CACHE_TTL_MS = 24 * 3600 * 1000;
const VALID_TICKER = /^[A-Z0-9]+$/;

// v2: le cache contient desormais des objets {symbol, venue, pair, quote}
// au lieu de simples chaines - une nouvelle version de cle evite de
// reinterpreter un ancien cache incompatible.
function watchlistCacheKey(limit) {
  return `signaltrade_watchlist_v2_${limit}`;
}

async function fetchBinanceAssets() {
  const resp = await fetch("https://api.binance.com/api/v3/exchangeInfo");
  const data = await resp.json();
  return new Set(
    data.symbols.filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING").map((s) => s.baseAsset)
  );
}

async function fetchHyperliquidAssets() {
  try {
    const resp = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMeta" }),
    });
    const data = await resp.json();
    return new Set(data.tokens.map((t) => t.name.toUpperCase()));
  } catch (e) {
    return new Set();
  }
}

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

  const [binanceAssets, hyperliquidAssets] = await Promise.all([
    fetchBinanceAssets(),
    fetchHyperliquidAssets(),
  ]);

  const result = [];
  for (const coin of candidates) {
    const ticker = coin.symbol.toUpperCase();
    if (!VALID_TICKER.test(ticker) || result.some((r) => r.symbol === ticker)) continue;

    if (binanceAssets.has(ticker)) {
      result.push({ symbol: ticker, venue: "binance", pair: `${ticker}USDT`, quote: "USDT" });
    } else if (hyperliquidAssets.has(ticker)) {
      result.push({ symbol: ticker, venue: "hyperliquid", pair: ticker, quote: "USDC" });
    } else {
      continue;
    }

    if (result.length >= limit) break;
  }
  return result;
}

async function getWatchlist(limit = CONFIG.watchlistSize) {
  const key = watchlistCacheKey(limit);
  const cached = localStorage.getItem(key);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Date.now() - parsed.fetchedAt < WATCHLIST_CACHE_TTL_MS) {
      return parsed.entries;
    }
  }

  try {
    const entries = await fetchTopSymbols(limit);
    localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), entries }));
    return entries;
  } catch (e) {
    if (cached) return JSON.parse(cached).entries;
    throw e;
  }
}

async function fetchBinanceKlines(pair, interval = CONFIG.timeframe, limit = CONFIG.candlesHistory) {
  const resp = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
  );
  if (!resp.ok) throw new Error(`Binance klines ${pair}: HTTP ${resp.status}`);
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

async function fetchHyperliquidKlines(coin, interval = "1d", limit = CONFIG.candlesHistory) {
  const intervalMs = 24 * 3600 * 1000; // seul "1d" est utilise ici
  const endTime = Date.now();
  const startTime = endTime - limit * intervalMs;
  const resp = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }),
  });
  if (!resp.ok) throw new Error(`Hyperliquid candles ${coin}: HTTP ${resp.status}`);
  const raw = await resp.json();
  return raw.map((k) => ({
    time: k.t,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
  }));
}

async function fetchCandles(entry) {
  if (entry.venue === "hyperliquid") return fetchHyperliquidKlines(entry.pair);
  return fetchBinanceKlines(entry.pair);
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
