import ccxt
import pandas as pd


def fetch_ohlcv(symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    exchange = ccxt.binance()
    raw = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df.set_index("timestamp", inplace=True)
    return df
