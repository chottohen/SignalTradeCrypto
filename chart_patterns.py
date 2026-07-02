from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

import config
from support_resistance import swing_points


@dataclass
class DoublePattern:
    kind: str  # "double_top" | "double_bottom"
    first_date: pd.Timestamp
    first_price: float
    second_date: pd.Timestamp
    second_price: float
    neckline: float
    confirmed: bool
    confirmation_date: pd.Timestamp | None

    @property
    def rationale(self) -> str:
        label = "Double top" if self.kind == "double_top" else "Double bottom"
        state = f"confirme le {self.confirmation_date.date()}" if self.confirmed else "en formation, pas encore confirme"
        return (
            f"{label}: pics/creux a {self.first_price:.2f} ({self.first_date.date()}) et "
            f"{self.second_price:.2f} ({self.second_date.date()}), ligne de cou a {self.neckline:.2f} — {state}"
        )


def _find_double(
    df: pd.DataFrame,
    pivots: pd.Series,
    kind: str,
    tolerance_pct: float,
    min_depth_pct: float,
) -> list[DoublePattern]:
    """Cherche des paires de pivots consecutifs (memes prix a +/- tolerance_pct,
    separes par un creux/pic intermediaire d'au moins min_depth_pct) et verifie
    si la ligne de cou a ete cassee depuis - seul ce qui suit `second_date` est
    regarde pour la confirmation, jamais avant (pas de lookahead).
    """
    pivots = pivots.sort_index()
    dates = pivots.index.to_list()
    prices = pivots.to_list()
    is_top = kind == "double_top"

    patterns = []
    for i in range(len(dates) - 1):
        d1, p1 = dates[i], prices[i]
        d2, p2 = dates[i + 1], prices[i + 1]

        if abs(p2 - p1) / p1 > tolerance_pct:
            continue

        between = df.loc[d1:d2, "close"]
        if len(between) < 3:
            continue
        extreme = between.min() if is_top else between.max()
        depth = abs(p1 - extreme) / p1
        if depth < min_depth_pct:
            continue

        neckline = extreme
        after = df.loc[df.index > d2, "close"]
        confirmed = False
        confirmation_date = None
        breaks = after[after < neckline] if is_top else after[after > neckline]
        if not breaks.empty:
            confirmed = True
            confirmation_date = breaks.index[0]

        patterns.append(
            DoublePattern(
                kind=kind,
                first_date=d1,
                first_price=float(p1),
                second_date=d2,
                second_price=float(p2),
                neckline=float(neckline),
                confirmed=confirmed,
                confirmation_date=confirmation_date,
            )
        )
    return patterns


def scan_double_patterns(
    df: pd.DataFrame,
    window: int = config.CHART_PATTERN_WINDOW,
    tolerance_pct: float = config.CHART_PATTERN_TOLERANCE_PCT,
    min_depth_pct: float = config.CHART_PATTERN_MIN_DEPTH_PCT,
) -> list[DoublePattern]:
    highs, lows = swing_points(df, window)
    tops = _find_double(df, highs, "double_top", tolerance_pct, min_depth_pct)
    bottoms = _find_double(df, lows, "double_bottom", tolerance_pct, min_depth_pct)
    return sorted(tops + bottoms, key=lambda p: p.second_date)


def latest_confirmed_pattern(
    df: pd.DataFrame,
    lookback_days: int = 5,
    window: int = config.CHART_PATTERN_WINDOW,
    tolerance_pct: float = config.CHART_PATTERN_TOLERANCE_PCT,
    min_depth_pct: float = config.CHART_PATTERN_MIN_DEPTH_PCT,
) -> DoublePattern | None:
    """Renvoie le double top/bottom le plus recent confirme dans les
    `lookback_days` derniers jours, ou None si aucun."""
    patterns = scan_double_patterns(df, window, tolerance_pct, min_depth_pct)
    confirmed = [p for p in patterns if p.confirmed]
    if not confirmed:
        return None
    latest = max(confirmed, key=lambda p: p.confirmation_date)
    if (df.index[-1] - latest.confirmation_date).days <= lookback_days:
        return latest
    return None
