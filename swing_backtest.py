from __future__ import annotations

import sys

import numpy as np
import pandas as pd

import config
from dca_benchmark import run_buy_and_hold
from historical_data import fetch_history
from metrics import performance_metrics
from swing_strategy import run_swing_backtest

COMPARISON_KEYS = ["periode", "valeur_finale", "rendement_total_pct", "cagr_pct", "max_drawdown_pct", "sharpe"]


def _fmt(value) -> str:
    return f"{value:.2f}" if isinstance(value, float) else str(value)


def compare(symbol: str, start: pd.Timestamp, end: pd.Timestamp) -> None:
    fetch_since = start - pd.Timedelta(days=config.WARMUP_PERIOD + 5)
    df = fetch_history(symbol, config.TIMEFRAME, fetch_since, end)
    if len(df) <= config.WARMUP_PERIOD:
        print(f"{symbol}: historique insuffisant ({len(df)} bougies)")
        return

    result = run_swing_backtest(symbol, df)
    actual_start = result.equity_curve.index[0]
    hold_equity = run_buy_and_hold(df[df.index >= actual_start], config.CAPITAL_TOTAL)

    swing_metrics = performance_metrics(result.equity_curve)
    hold_metrics = performance_metrics(hold_equity)

    print(f"Comparaison {symbol} du {actual_start.date()} au {end.date()}, capital initial = {config.CAPITAL_TOTAL:.0f}\n")
    print(f"{'':22s} {'Swing (tactique+ST large)':>28s} {'Buy & hold':>18s}")
    for key in COMPARISON_KEYS:
        s = _fmt(swing_metrics.get(key, "n/a"))
        h = _fmt(hold_metrics.get(key, "n/a"))
        print(f"{key:22s} {s:>28s} {h:>18s}")

    closed = result.closed_trades
    print(f"{'trades':22s} {len(closed):>28d}")
    if closed:
        returns = np.array([t.return_pct for t in closed])
        durations = np.array([t.duration_days for t in closed])
        wins = returns[returns > 0]
        print(f"{'taux de reussite':22s} {len(wins) / len(closed) * 100:>27.1f}%")
        print(f"{'gain moyen/trade':22s} {returns.mean():>27.2f}%")
        print(f"{'duree mediane':22s} {int(np.median(durations)):>26d} j")
        print(f"{'meilleur trade':22s} {returns.max():>27.2f}%")
        print(f"{'pire trade':22s} {returns.min():>27.2f}%")


def compare_last_years(symbol: str, years: float) -> None:
    end = pd.Timestamp.now("UTC").tz_localize(None)
    start = end - pd.Timedelta(days=years * 365.25)
    compare(symbol, start, end)


if __name__ == "__main__":
    symbol_arg = sys.argv[1] if len(sys.argv) > 1 else "BTC/USDT"
    if len(sys.argv) >= 4:
        compare(symbol_arg, pd.Timestamp(sys.argv[2]), pd.Timestamp(sys.argv[3]))
    else:
        years_arg = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
        compare_last_years(symbol_arg, years_arg)
