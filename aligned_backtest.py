from __future__ import annotations

import sys

import pandas as pd

import config
from aligned_strategy import run_aligned_backtest
from dca_benchmark import run_buy_and_hold
from historical_data import fetch_history
from metrics import performance_metrics

COMPARISON_KEYS = ["periode", "valeur_finale", "rendement_total_pct", "cagr_pct", "max_drawdown_pct", "sharpe"]


def _fmt(value) -> str:
    return f"{value:.2f}" if isinstance(value, float) else str(value)


def compare(symbol: str, start: pd.Timestamp, end: pd.Timestamp) -> None:
    fetch_since = start - pd.Timedelta(days=config.WARMUP_PERIOD + 5)

    df = fetch_history(symbol, config.TIMEFRAME, fetch_since, end)
    if len(df) <= config.WARMUP_PERIOD:
        print(f"{symbol}: historique insuffisant ({len(df)} bougies)")
        return

    aligned = run_aligned_backtest(symbol, df)
    actual_start = aligned.equity_curve.index[0]
    hold_equity = run_buy_and_hold(df[df.index >= actual_start], config.CAPITAL_TOTAL)

    aligned_metrics = performance_metrics(aligned.equity_curve)
    hold_metrics = performance_metrics(hold_equity)

    print(f"Comparaison {symbol} du {actual_start.date()} au {end.date()}, capital initial = {config.CAPITAL_TOTAL:.0f}\n")
    print(f"{'':22s} {'Aligne (tactique+ST)':>24s} {'Buy & hold':>18s}")
    for key in COMPARISON_KEYS:
        a = _fmt(aligned_metrics.get(key, "n/a"))
        h = _fmt(hold_metrics.get(key, "n/a"))
        print(f"{key:22s} {a:>24s} {h:>18s}")
    print(f"{'trades':22s} {len(aligned.trades):>24d}")
    print(f"{'% temps investi':22s} {aligned.time_invested_pct:>23.1f}%")

    if aligned.trades:
        wins = [t for t in aligned.trades if t.return_pct > 0]
        print(f"{'taux de reussite':22s} {len(wins) / len(aligned.trades) * 100:>23.1f}%")


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
