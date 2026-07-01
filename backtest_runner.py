from __future__ import annotations

import sys

import pandas as pd

import config
from backtester import run_backtest
from historical_data import fetch_history
from universe import get_watchlist


def run(years: float = 3.0) -> None:
    since = pd.Timestamp.now("UTC").tz_localize(None) - pd.Timedelta(days=years * 365.25)
    watchlist = get_watchlist(config.WATCHLIST_SIZE)
    print(f"Backtest sur {years} ans (depuis {since.date()}), {len(watchlist)} actifs\n")

    for symbol in watchlist:
        df = fetch_history(symbol, config.TIMEFRAME, since)
        try:
            result = run_backtest(symbol, df)
        except ValueError as exc:
            print(f"{symbol}: {exc}\n")
            continue

        summary = result.summary()
        if summary.get("trades", 0) == 0:
            print(f"{symbol}: aucun trade genere sur la periode\n")
            continue

        print(f"### {symbol}")
        for key, value in summary.items():
            if key == "symbol":
                continue
            print(f"- {key}: {value:.2f}" if isinstance(value, float) else f"- {key}: {value}")
        print()


if __name__ == "__main__":
    years_arg = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
    run(years_arg)
