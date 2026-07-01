from __future__ import annotations

import sys

import pandas as pd

import config
from historical_data import fetch_history
from trend_regime import scan_trend_history
from universe import get_watchlist


def run(years: float = 10.0) -> None:
    since = pd.Timestamp.now("UTC").tz_localize(None) - pd.Timedelta(days=years * 365.25)

    for symbol in get_watchlist(config.WATCHLIST_SIZE):
        df = fetch_history(symbol, config.TIMEFRAME, since)
        alerts = scan_trend_history(symbol, df)
        print(f"### {symbol} — {len(alerts)} alerte(s) de tendance de fond")
        for a in alerts:
            print(
                f"- {a.date.date()} [{a.type}] prix={a.close:.2f} "
                f"EMA{config.EMA_SLOW}={a.ema_slow:.2f} EMA{config.EMA_TREND}={a.ema_trend:.2f} ADX={a.adx:.1f}"
            )
        print()


if __name__ == "__main__":
    years_arg = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
    run(years_arg)
