from __future__ import annotations

import time
from pathlib import Path

import ccxt
import pandas as pd

DATA_DIR = Path(__file__).parent / "data"


def _cache_path(symbol: str, timeframe: str) -> Path:
    safe_symbol = symbol.replace("/", "-")
    return DATA_DIR / f"{safe_symbol}_{timeframe}.csv"


def fetch_history(
    symbol: str, timeframe: str, since: pd.Timestamp, until: pd.Timestamp | None = None
) -> pd.DataFrame:
    """Recupere l'historique OHLCV quotidien avec un cache local incremental.

    Peut etre rappelee avec un `since` plus ancien pour etendre progressivement
    l'historique (ex: 3 ans puis 10 ans) sans re-telecharger les donnees deja
    en cache. Si l'actif n'existait pas encore a `since` (listing recent sur
    l'exchange), les donnees renvoyees demarrent simplement a la date de listing.
    """
    until = until or pd.Timestamp.now("UTC").tz_localize(None)
    exchange = ccxt.binance()
    cache_file = _cache_path(symbol, timeframe)

    cached = pd.DataFrame()
    if cache_file.exists():
        cached = pd.read_csv(cache_file, index_col="timestamp", parse_dates=True)

    missing_ranges = []
    if cached.empty:
        missing_ranges.append((since, until))
    else:
        if since < cached.index.min():
            missing_ranges.append((since, cached.index.min()))
        if until > cached.index.max():
            missing_ranges.append((cached.index.max(), until))

    fetched_frames = [cached] if not cached.empty else []
    for range_since, range_until in missing_ranges:
        fetched_frames.append(_paginated_fetch(exchange, symbol, timeframe, range_since, range_until))

    full = pd.concat(fetched_frames) if fetched_frames else cached
    full = full[~full.index.duplicated(keep="last")].sort_index()

    DATA_DIR.mkdir(exist_ok=True)
    full.to_csv(cache_file, index_label="timestamp")

    return full[(full.index >= since) & (full.index <= until)]


def _paginated_fetch(
    exchange: ccxt.Exchange, symbol: str, timeframe: str, since: pd.Timestamp, until: pd.Timestamp
) -> pd.DataFrame:
    since_ms = int(since.timestamp() * 1000)
    until_ms = int(until.timestamp() * 1000)
    all_rows = []

    while since_ms < until_ms:
        batch = exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=since_ms, limit=1000)
        if not batch:
            break
        all_rows.extend(batch)
        last_ts = batch[-1][0]
        if last_ts <= since_ms:
            break
        since_ms = last_ts + 1
        time.sleep(exchange.rateLimit / 1000)

    df = pd.DataFrame(all_rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
    if df.empty:
        return df.set_index(pd.DatetimeIndex([], name="timestamp"))
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df.drop_duplicates(subset="timestamp").set_index("timestamp")
