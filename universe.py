from __future__ import annotations

import json
import re
import time
from pathlib import Path

import ccxt
import requests

import config

_VALID_TICKER = re.compile(r"^[A-Z0-9]+$")

CACHE_FILE = Path(__file__).parent / "data" / "watchlist_top50.json"
CACHE_TTL_SECONDS = 24 * 3600
COINGECKO_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets"


def _fetch_stablecoin_ids() -> set[str]:
    resp = requests.get(
        COINGECKO_MARKETS_URL,
        params={"vs_currency": "usd", "category": "stablecoins", "per_page": 250, "page": 1},
        timeout=15,
    )
    resp.raise_for_status()
    return {coin["id"] for coin in resp.json()}


def _fetch_top_market_cap(limit: int) -> list[dict]:
    stablecoin_ids = _fetch_stablecoin_ids()
    resp = requests.get(
        COINGECKO_MARKETS_URL,
        params={"vs_currency": "usd", "order": "market_cap_desc", "per_page": 250, "page": 1},
        timeout=15,
    )
    resp.raise_for_status()
    coins = [c for c in resp.json() if c["id"] not in stablecoin_ids]
    return coins[:limit]


def _to_binance_usdt_symbols(coins: list[dict]) -> list[str]:
    exchange = ccxt.binance()
    markets = exchange.load_markets()
    symbols = []
    for coin in coins:
        ticker = coin["symbol"].upper()
        pair = f"{ticker}/USDT"
        if _VALID_TICKER.match(ticker) and pair in markets and pair not in symbols:
            symbols.append(pair)
    return symbols


def fetch_watchlist(limit: int = 50) -> list[str]:
    """Top `limit` cryptos par capitalisation, hors stablecoins, limitees aux
    paires XXX/USDT effectivement cotees sur Binance.

    On demande `limit * 2` candidats a CoinGecko pour compenser les coins non
    listes sur Binance (ou listes sous un autre ticker), tout en conservant
    l'ordre de capitalisation.
    """
    coins = _fetch_top_market_cap(limit * 2)
    symbols = _to_binance_usdt_symbols(coins)
    return symbols[:limit]


def get_watchlist(limit: int = 50, force_refresh: bool = False) -> list[str]:
    """Watchlist mise en cache localement (rafraichie une fois par jour) pour
    eviter de dependre de CoinGecko/Binance a chaque lancement. Retombe sur le
    cache existant (meme perime) puis sur `config.WATCHLIST` si l'API est
    indisponible.
    """
    if not force_refresh and CACHE_FILE.exists():
        cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if cached.get("limit") == limit and time.time() - cached["fetched_at"] < CACHE_TTL_SECONDS:
            return cached["symbols"]

    try:
        symbols = fetch_watchlist(limit)
    except Exception:
        if CACHE_FILE.exists():
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))["symbols"]
        return config.WATCHLIST

    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps({"fetched_at": time.time(), "limit": limit, "symbols": symbols}, indent=2),
        encoding="utf-8",
    )
    return symbols
