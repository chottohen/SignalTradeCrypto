from __future__ import annotations

import pandas as pd


def performance_metrics(equity: pd.Series, base_capital: float | None = None) -> dict:
    """Calcule rendement/CAGR/drawdown/Sharpe a partir d'une courbe de valeur.

    `base_capital` est le capital reellement engage a comparer a la valeur
    finale. Par defaut on utilise `equity.iloc[0]` (cas d'un capital investi
    en une fois au debut, ex: strategie signal). Pour un DCA ou le capital est
    deploye progressivement, passer le capital total investi sur la periode
    (equity.iloc[0] serait alors trompeur: il ne represente que la 1ere
    mensualite, pas le capital total).
    """
    if len(equity) < 2:
        return {}

    base = base_capital if base_capital is not None else equity.iloc[0]

    running_max = equity.cummax()
    drawdown = (equity - running_max) / running_max
    daily_returns = equity.pct_change().dropna()

    years = (equity.index[-1] - equity.index[0]).days / 365.25
    total_return = equity.iloc[-1] / base - 1
    cagr = (equity.iloc[-1] / base) ** (1 / years) - 1 if years > 0 and base > 0 else 0.0
    sharpe = (
        daily_returns.mean() / daily_returns.std() * (365.25**0.5)
        if daily_returns.std() > 0
        else 0.0
    )

    return {
        "periode": f"{equity.index[0].date()} -> {equity.index[-1].date()} ({years:.1f} ans)",
        "valeur_finale": equity.iloc[-1],
        "rendement_total_pct": total_return * 100,
        "cagr_pct": cagr * 100,
        "max_drawdown_pct": drawdown.min() * 100,
        "sharpe": sharpe,
    }
