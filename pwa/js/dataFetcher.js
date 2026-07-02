// Port de universe.py + data_fetcher.py + fundamental_filter.py
// Toute la pile tourne dans le navigateur: appels directs a Binance,
// CoinGecko, alternative.me, Hyperliquid et Kraken (CORS ouvert partout).
//
// Trois venues possibles par actif, dans cet ordre de priorite:
// - "binance": paire XXXUSDT, klines classiques.
// - "hyperliquid": repli pour les actifs top 100 absents de Binance (ex:
//   HYPE) - candleSnapshot journalier avec volume, qualite equivalente a
//   Binance (contrairement a l'endpoint OHLC gratuit de CoinGecko, limite a
//   des bougies de 4 jours sans volume au-dela de 30 jours d'historique).
// - "kraken": second repli pour ce que ni Binance ni Hyperliquid ne liste
//   (ex: XMR, delisté de Binance pour raisons reglementaires; MNT, KAS,
//   AERO...). Couverture testee: Binance+Hyperliquid seuls = 66/100 du top
//   100 CoinGecko strict; +Kraken = 84/100. Les 16 restants sont presque
//   tous des fonds tokenises (BUIDL, USYC, JTRSY...) sans vraies bougies de
//   prix a analyser, ou des tokens propres a un exchange (LEO, KCS, GT...)
//   qui demanderaient une integration dediee pour un seul actif chacun -
//   retour sur investissement juge trop faible pour aller plus loin.
//
// Le "top 100" reste entierement pilote par le classement CoinGecko: les
// venues de prix ne font que fournir des donnees pour un actif deja
// retenu, elles n'en ajoutent jamais un qui n'y figurerait pas.

const WATCHLIST_CACHE_TTL_MS = 24 * 3600 * 1000;
const VALID_TICKER = /^[A-Z0-9]+$/;
const KRAKEN_TICKER_ALIASES = { XBT: "BTC" };

// v4: ajout du champ "rank" (classement par capitalisation) sur chaque
// entree - nouvelle version de cle pour forcer un rafraichissement plutot
// que de garder un cache v3 qui n'aurait pas ce champ.
function watchlistCacheKey(limit) {
  return `signaltrade_watchlist_v4_${limit}`;
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

// Renvoie une Map ticker -> nom de paire Kraken (ex: "BTC" -> "XBTUSD").
// Necessite de croiser /Assets (code interne -> altname propre, ex:
// XXBT -> XBT) et /AssetPairs (quelle paire USD existe pour quel code) car
// Kraken utilise des codes internes prefixes X/Z herites de l'ISO 4217 pour
// les actifs historiques (XXBT, XETH...), differents du ticker usuel.
async function fetchKrakenAssets() {
  try {
    const [assetsResp, pairsResp] = await Promise.all([
      fetch("https://api.kraken.com/0/public/Assets"),
      fetch("https://api.kraken.com/0/public/AssetPairs"),
    ]);
    const assetsData = await assetsResp.json();
    const pairsData = await pairsResp.json();

    const codeToTicker = {};
    for (const [code, info] of Object.entries(assetsData.result)) {
      const alt = (info.altname || code).toUpperCase();
      codeToTicker[code] = KRAKEN_TICKER_ALIASES[alt] || alt;
    }

    const map = new Map();
    for (const pairInfo of Object.values(pairsData.result)) {
      if (pairInfo.quote !== "ZUSD") continue;
      const ticker = codeToTicker[pairInfo.base];
      if (ticker && !map.has(ticker)) map.set(ticker, pairInfo.altname);
    }
    return map;
  } catch (e) {
    return new Map();
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

  const [binanceAssets, hyperliquidAssets, krakenAssets] = await Promise.all([
    fetchBinanceAssets(),
    fetchHyperliquidAssets(),
    fetchKrakenAssets(),
  ]);

  const result = [];
  for (const coin of candidates) {
    const ticker = coin.symbol.toUpperCase();
    if (!VALID_TICKER.test(ticker) || result.some((r) => r.symbol === ticker)) continue;

    const rank = coin.market_cap_rank;
    if (binanceAssets.has(ticker)) {
      result.push({ symbol: ticker, venue: "binance", pair: `${ticker}USDT`, quote: "USDT", rank });
    } else if (hyperliquidAssets.has(ticker)) {
      result.push({ symbol: ticker, venue: "hyperliquid", pair: ticker, quote: "USDC", rank });
    } else if (krakenAssets.has(ticker)) {
      result.push({ symbol: ticker, venue: "kraken", pair: krakenAssets.get(ticker), quote: "USD", rank });
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

async function fetchKrakenKlines(pairAltname, limit = CONFIG.candlesHistory) {
  const resp = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pairAltname}&interval=1440`);
  if (!resp.ok) throw new Error(`Kraken OHLC ${pairAltname}: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error && data.error.length) throw new Error(`Kraken OHLC ${pairAltname}: ${data.error.join(", ")}`);

  const resultKey = Object.keys(data.result).find((k) => k !== "last");
  const raw = data.result[resultKey] || [];
  const candles = raw.map((k) => ({
    time: k[0] * 1000, // Kraken renvoie des secondes, pas des ms
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[6]),
  }));
  return candles.slice(-limit);
}

async function fetchCandles(entry) {
  if (entry.venue === "hyperliquid") return fetchHyperliquidKlines(entry.pair);
  if (entry.venue === "kraken") return fetchKrakenKlines(entry.pair);
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
