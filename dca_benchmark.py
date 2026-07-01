from __future__ import annotations

import pandas as pd

import config
from metrics import performance_metrics


def run_dca(df: pd.DataFrame, capital: float = config.CAPITAL_TOTAL) -> pd.Series:
    """Simule un DCA mensuel: un montant fixe est investi au premier jour de
    chaque mois disponible dans `df`, le total investi sur la periode egalant
    `capital`. Aucune vente, aucun stop: on capitalise et on garde jusqu'a la fin.
    """
    first_of_month = df.groupby(df.index.to_period("M")).apply(lambda g: g.index[0])
    n_months = len(first_of_month)
    if n_months == 0:
        raise ValueError("historique vide")

    monthly_amount = capital / n_months
    buy_dates = set(first_of_month.to_numpy())

    units = 0.0
    values = {}
    for date, row in df.iterrows():
        if date.to_datetime64() in buy_dates:
            units += monthly_amount / row["close"]
        values[date] = units * row["close"]

    return pd.Series(values).sort_index()


def summarize_dca(symbol: str, df: pd.DataFrame, capital: float = config.CAPITAL_TOTAL) -> dict:
    equity = run_dca(df, capital)
    return {
        "symbol": symbol,
        "strategie": "DCA_mensuel",
        **performance_metrics(equity, base_capital=capital),
    }
