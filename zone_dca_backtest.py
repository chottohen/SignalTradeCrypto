from __future__ import annotations

import sys

import pandas as pd

import config
from dca_benchmark import run_buy_and_hold, run_dca
from historical_data import fetch_history
from metrics import performance_metrics
from zone_dca import run_zone_dca

COMPARISON_KEYS = ["periode", "valeur_finale", "rendement_total_pct", "cagr_pct", "max_drawdown_pct", "sharpe"]


def _fmt(value) -> str:
    return f"{value:.2f}" if isinstance(value, float) else str(value)


def compare(symbol: str, start: pd.Timestamp, end: pd.Timestamp) -> None:
    df = fetch_history(symbol, config.TIMEFRAME, start, end)
    if df.empty:
        print(f"{symbol}: historique insuffisant")
        return

    n_months = max(1, len(df.groupby(df.index.to_period("M"))))
    n_tranches = n_months

    zone_result = run_zone_dca(df, config.CAPITAL_TOTAL, n_tranches)
    dca_equity = run_dca(df, config.CAPITAL_TOTAL)
    hold_equity = run_buy_and_hold(df, config.CAPITAL_TOTAL)

    zone_metrics = performance_metrics(zone_result.equity_curve, base_capital=config.CAPITAL_TOTAL)
    dca_metrics = performance_metrics(dca_equity, base_capital=config.CAPITAL_TOTAL)
    hold_metrics = performance_metrics(hold_equity)

    print(f"Comparaison {symbol} du {df.index[0].date()} au {df.index[-1].date()}, capital = {config.CAPITAL_TOTAL:.0f}, {n_tranches} tranches\n")
    print(f"{'':22s} {'Zones DCA':>18s} {'DCA mensuel':>18s} {'Buy & hold':>18s}")
    for key in COMPARISON_KEYS:
        z = _fmt(zone_metrics.get(key, "n/a"))
        d = _fmt(dca_metrics.get(key, "n/a"))
        h = _fmt(hold_metrics.get(key, "n/a"))
        print(f"{key:22s} {z:>18s} {d:>18s} {h:>18s}")

    print(f"\n{'achats effectues':22s} {len(zone_result.purchases):>18d} {n_tranches:>18d}")
    print(f"{'capital deploye':22s} {zone_result.capital_deployed:>18.0f} {config.CAPITAL_TOTAL:>18.0f}")
    print(f"{'capital en cash':22s} {zone_result.capital_remaining:>18.0f} {0:>18.0f}")

    if zone_result.average_cost_basis:
        print(f"{'prix de revient moyen':22s} {zone_result.average_cost_basis:>18.2f}")

    dca_units = sum(
        (config.CAPITAL_TOTAL / n_months) / df.loc[d, "close"]
        for d in df.groupby(df.index.to_period("M")).apply(lambda g: g.index[0])
    )
    dca_avg_cost = config.CAPITAL_TOTAL / dca_units if dca_units else None
    if dca_avg_cost:
        print(f"{'prix de revient DCA':22s} {dca_avg_cost:>18.2f}")

    print(f"{'prix actuel':22s} {df['close'].iloc[-1]:>18.2f}")


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
