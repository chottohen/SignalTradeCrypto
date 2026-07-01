from __future__ import annotations

import itertools
import sys

import pandas as pd

import config
from backtester import run_backtest
from historical_data import fetch_history
from universe import get_watchlist

PARAM_GRID = {
    "MIN_CONFIRMATIONS": [2, 3],
    "ADX_TREND_THRESHOLD": [15, 20, 25],
    "ATR_STOP_MULTIPLIER": [1.0, 1.5, 2.0],
    "TAKE_PROFIT_RR": [1.5, 2.0, 3.0],
}


def _param_combinations(grid: dict) -> list[dict]:
    keys = list(grid.keys())
    return [dict(zip(keys, values)) for values in itertools.product(*grid.values())]


def _apply_params(params: dict) -> dict:
    previous = {key: getattr(config, key) for key in params}
    for key, value in params.items():
        setattr(config, key, value)
    return previous


def optimize(symbol: str, df: pd.DataFrame, grid: dict = PARAM_GRID, metric: str = "sharpe") -> pd.DataFrame:
    """Grid search sequentiel sur les parametres de `config`.

    ATTENTION: un score optimise sur les memes donnees que celles utilisees
    pour choisir les parametres est sujet a l'overfitting (surapprentissage).
    Les meilleurs parametres trouves ici doivent etre valides sur une periode
    hors echantillon avant tout usage reel.
    """
    rows = []
    for params in _param_combinations(grid):
        previous = _apply_params(params)
        try:
            result = run_backtest(symbol, df)
            summary = result.summary()
        except ValueError:
            summary = {"trades": 0}
        finally:
            _apply_params(previous)

        rows.append({**params, **summary})

    ranked = pd.DataFrame(rows)
    ranked = ranked[ranked["trades"] >= 10]
    if metric in ranked.columns:
        ranked = ranked.sort_values(metric, ascending=False, na_position="last")
    return ranked.reset_index(drop=True)


if __name__ == "__main__":
    years = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
    since = pd.Timestamp.now("UTC").tz_localize(None) - pd.Timedelta(days=years * 365.25)

    for symbol in get_watchlist(config.WATCHLIST_SIZE):
        df = fetch_history(symbol, config.TIMEFRAME, since)
        ranked = optimize(symbol, df)
        print(f"\n### {symbol} — top 5 combinaisons (metrique: sharpe, trades >= 10)")
        cols = list(PARAM_GRID.keys()) + ["trades", "taux_de_reussite", "cagr_pct", "max_drawdown_pct", "sharpe"]
        print(ranked[cols].head(5).to_string(index=False))
