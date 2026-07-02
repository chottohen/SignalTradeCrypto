from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

import config


@dataclass
class Level:
    price: float
    kind: str  # "support" | "resistance"
    touches: int
    last_touch: pd.Timestamp
    horizon: str  # "moyen_terme" | "long_terme"


def swing_points(df: pd.DataFrame, window: int) -> tuple[pd.Series, pd.Series]:
    """Points pivots calcules sur les clotures (pas les meches high/low): un plus
    haut/bas local sur une fenetre centree de +/- `window` bougies. Les `window`
    derniers jours ne peuvent pas encore etre confirmes (pas assez de recul) et
    sont naturellement exclus (NaN).

    Travailler sur la cloture plutot que high/low evite par construction les
    faux niveaux issus de meches de flash crash / incidents de liquidite (ex:
    ATOM a 0.001$ pendant quelques secondes le 10/10/2025, alors que la cloture
    ce jour-la etait a 2.95$): une meche isolee n'affecte jamais la cloture.
    """
    closes = df["close"]
    span = window * 2 + 1
    is_high = closes == closes.rolling(span, center=True).max()
    is_low = closes == closes.rolling(span, center=True).min()
    return closes[is_high.fillna(False)], closes[is_low.fillna(False)]


def _cluster(points: pd.Series, kind: str, horizon: str, tolerance_pct: float) -> list[Level]:
    if points.empty:
        return []

    ordered = points.sort_values()
    clusters: list[list[tuple[pd.Timestamp, float]]] = []
    for date, price in ordered.items():
        if clusters and abs(price - clusters[-1][-1][1]) / clusters[-1][-1][1] <= tolerance_pct:
            clusters[-1].append((date, price))
        else:
            clusters.append([(date, price)])

    return [
        Level(
            price=float(np.mean([p for _, p in cluster])),
            kind=kind,
            touches=len(cluster),
            last_touch=max(d for d, _ in cluster),
            horizon=horizon,
        )
        for cluster in clusters
    ]


def find_levels(df: pd.DataFrame, window: int, horizon: str, tolerance_pct: float = config.SR_TOLERANCE_PCT) -> list[Level]:
    swing_highs, swing_lows = swing_points(df, window)
    resistances = _cluster(swing_highs, "resistance", horizon, tolerance_pct)
    supports = _cluster(swing_lows, "support", horizon, tolerance_pct)
    return sorted(resistances + supports, key=lambda lvl: lvl.price)


def nearest_levels(levels: list[Level], current_price: float, top_n: int = config.SR_LEVELS_PER_SIDE) -> dict[str, list[Level]]:
    supports = sorted(
        (lvl for lvl in levels if lvl.kind == "support" and lvl.price < current_price),
        key=lambda lvl: current_price - lvl.price,
    )[:top_n]
    resistances = sorted(
        (lvl for lvl in levels if lvl.kind == "resistance" and lvl.price > current_price),
        key=lambda lvl: lvl.price - current_price,
    )[:top_n]
    return {"support": supports, "resistance": resistances}


def analyze_symbol(df_medium: pd.DataFrame, df_long: pd.DataFrame) -> dict[str, list[Level]]:
    current_price = df_long["close"].iloc[-1]

    medium_levels = find_levels(df_medium, config.SR_MEDIUM_TERM_WINDOW, "moyen_terme")
    long_levels = find_levels(df_long, config.SR_LONG_TERM_WINDOW, "long_terme")

    nearest_medium = nearest_levels(medium_levels, current_price)
    nearest_long = nearest_levels(long_levels, current_price)

    return {
        "support": nearest_medium["support"] + nearest_long["support"],
        "resistance": nearest_medium["resistance"] + nearest_long["resistance"],
    }
