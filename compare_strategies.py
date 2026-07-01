from __future__ import annotations

import sys

import pandas as pd

import config
from backtester import WARMUP_PERIOD, run_backtest
from dca_benchmark import summarize_dca
from historical_data import fetch_history
from universe import get_watchlist

COMPARISON_KEYS = ["periode", "valeur_finale", "rendement_total_pct", "cagr_pct", "max_drawdown_pct", "sharpe"]


def _fmt(value) -> str:
    return f"{value:.2f}" if isinstance(value, float) else str(value)


def compare(start: pd.Timestamp, end: pd.Timestamp) -> None:
    """Compare la strategie signal au DCA mensuel entre `start` et `end`.

    Un tampon de WARMUP_PERIOD jours est telecharge avant `start` pour que les
    indicateurs (EMA200 notamment) soient deja valides au debut de la fenetre
    demandee: les deux strategies sont ainsi comparees exactement sur [start, end].
    """
    fetch_since = start - pd.Timedelta(days=WARMUP_PERIOD + 5)
    watchlist = get_watchlist(config.WATCHLIST_SIZE)
    print(f"Comparaison du {start.date()} au {end.date()}, capital initial = {config.CAPITAL_TOTAL:.0f}, {len(watchlist)} actifs\n")

    for symbol in watchlist:
        df = fetch_history(symbol, config.TIMEFRAME, fetch_since, end)
        if len(df) <= WARMUP_PERIOD:
            print(f"### {symbol}: historique insuffisant ({len(df)} bougies, actif probablement pas encore liste)\n")
            continue

        signal_summary = run_backtest(symbol, df).summary()
        dca_summary = summarize_dca(symbol, df.iloc[WARMUP_PERIOD:])

        print(f"### {symbol}")
        print(f"{'':22s} {'Signal (trading actif)':>26s} {'DCA mensuel':>18s}")
        for key in COMPARISON_KEYS:
            print(f"{key:22s} {_fmt(signal_summary.get(key, 'n/a')):>26s} {_fmt(dca_summary.get(key, 'n/a')):>18s}")
        print(f"{'trades':22s} {_fmt(signal_summary.get('trades', 0)):>26s} {'-':>18s}")
        print()


def compare_last_years(years: float) -> None:
    end = pd.Timestamp.now("UTC").tz_localize(None)
    start = end - pd.Timedelta(days=years * 365.25)
    compare(start, end)


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        compare(pd.Timestamp(sys.argv[1]), pd.Timestamp(sys.argv[2]))
    else:
        years_arg = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
        compare_last_years(years_arg)
