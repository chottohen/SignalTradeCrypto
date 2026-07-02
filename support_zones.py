from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

import config


@dataclass
class SupportZone:
    center: float
    low: float
    high: float
    touches: int
    last_touch: pd.Timestamp
    kind: str = "support"  # "support" (ancien creux) | "ancien_ath" (sommet de cycle depasse)

    def contains(self, price: float) -> bool:
        return self.low <= price <= self.high


def resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.resample("W")
        .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
        .dropna()
    )


def _weekly_pivots(df_weekly: pd.DataFrame, window: int, kind: str) -> pd.Series:
    """Pivots hebdomadaires (cloture) sur fenetre centree. kind='low': creux
    locaux (deja suivis d'un rebond par construction). kind='high': sommets
    locaux (deja suivis d'un repli par construction)."""
    closes = df_weekly["close"]
    span = window * 2 + 1
    if kind == "low":
        is_pivot = closes == closes.rolling(span, center=True).min()
    else:
        is_pivot = closes == closes.rolling(span, center=True).max()
    return closes[is_pivot.fillna(False)]


def _cluster_pivots(
    pivots: pd.Series, tolerance_pct: float, min_touches: int, kind: str
) -> list[SupportZone]:
    if pivots.empty:
        return []

    ordered = pivots.sort_values()
    clusters: list[list[tuple[pd.Timestamp, float]]] = []
    for date, price in ordered.items():
        if clusters:
            cluster_mean = np.mean([p for _, p in clusters[-1]])
            if abs(price - cluster_mean) / cluster_mean <= tolerance_pct:
                clusters[-1].append((date, price))
                continue
        clusters.append([(date, price)])

    zones = []
    for cluster in clusters:
        if len(cluster) < min_touches:
            continue
        prices = [p for _, p in cluster]
        dates = [d for d, _ in cluster]
        center = float(np.mean(prices))
        zones.append(
            SupportZone(
                center=center,
                low=center * (1 - tolerance_pct),
                high=center * (1 + tolerance_pct),
                touches=len(cluster),
                last_touch=max(dates),
                kind=kind,
            )
        )
    return zones


def _cycle_ath_points(
    df_weekly: pd.DataFrame, min_drawdown_pct: float = config.ZONE_ATH_MIN_DRAWDOWN_PCT
) -> list[tuple[pd.Timestamp, float]]:
    """Identifie les vrais sommets de cycle: chaque 'regne' d'un plus haut
    historique (running max) qui a fini par etre depasse par un plus haut
    encore superieur plus tard, ET qui a ete suivi d'un repli d'au moins
    `min_drawdown_pct` avant d'etre repris. Sans ce filtre, chaque nouveau
    plus-haut hebdomadaire pendant une hausse continue (ex: 2021, 2024-2025)
    compte comme un "ancien ATH" des qu'il est depasse la semaine suivante -
    du bruit, pas de vrais sommets memorables comme les ATH de 2017 ou 2021.

    Le dernier regne (l'ATH actuel, jamais depasse dans les donnees
    fournies) est exclu: il n'est pas encore "casse", donc pas encore
    utilisable comme support.
    """
    close = df_weekly["close"]
    running_max = close.cummax()
    group_id = running_max.ne(running_max.shift(1)).cumsum()

    groups = pd.DataFrame({"close": close, "running_max": running_max, "group": group_id})
    grouped = list(groups.groupby("group"))

    points = []
    for _, sub in grouped[:-1]:
        ath_value = float(sub["running_max"].iloc[0])
        ath_date = sub.index[-1]
        drawdown = (ath_value - sub["close"].min()) / ath_value
        if drawdown >= min_drawdown_pct:
            points.append((ath_date, ath_value))

    return points


def detect_ath_zones(df_weekly: pd.DataFrame, tolerance_pct: float = config.ZONE_TOLERANCE_PCT) -> list[SupportZone]:
    """Zones basees sur les anciens ATH de BTC (sommets de cycle depasses
    depuis): un ancien plus haut historique, une fois reclame par un nouveau
    record, devient souvent un support majeur au repli suivant (ex: l'ATH de
    2017 ~20k a agi comme support en 2020-2021; celui de 2021 ~69k est devenu
    une zone surveillee des que BTC l'a repris). Contrairement aux
    resistances locales, un ancien ATH est intrinsequement significatif sans
    exiger plusieurs retests prealables: il a fallu un cycle entier pour le
    depasser.
    """
    ath_points = _cycle_ath_points(df_weekly)
    return [
        SupportZone(
            center=price,
            low=price * (1 - tolerance_pct),
            high=price * (1 + tolerance_pct),
            touches=1,
            last_touch=date,
            kind="ancien_ath",
        )
        for date, price in ath_points
    ]


def detect_zones_from_weekly(
    df_weekly: pd.DataFrame,
    window: int = config.ZONE_WEEKLY_WINDOW,
    tolerance_pct: float = config.ZONE_TOLERANCE_PCT,
    min_touches: int = config.ZONE_MIN_TOUCHES,
    include_old_ath: bool = True,
) -> list[SupportZone]:
    """Zones d'interet a la baisse: anciens creux regroupes en zones de
    +/- `tolerance_pct` autour d'un centre stable, retenus seulement si
    testes au moins `min_touches` fois (plusieurs retests concluants).

    Si `include_old_ath`, ajoute aussi les anciens sommets de cycle (ATH)
    deja depasses depuis - voir `detect_ath_zones`. Contrairement a une
    resistance locale quelconque (testee et rejetee), un ancien ATH ne
    represente pas juste un plafond recent tout juste franchi: il a fallu un
    cycle complet pour le reprendre, ce qui en fait un niveau structurel bien
    plus significatif.
    """
    lows = _weekly_pivots(df_weekly, window, "low")
    zones = _cluster_pivots(lows, tolerance_pct, min_touches, "support")

    if include_old_ath:
        zones.extend(detect_ath_zones(df_weekly, tolerance_pct))

    return sorted(zones, key=lambda z: z.center)


def detect_support_zones(
    df: pd.DataFrame,
    window: int = config.ZONE_WEEKLY_WINDOW,
    tolerance_pct: float = config.ZONE_TOLERANCE_PCT,
    min_touches: int = config.ZONE_MIN_TOUCHES,
    include_old_ath: bool = True,
) -> list[SupportZone]:
    return detect_zones_from_weekly(resample_weekly(df), window, tolerance_pct, min_touches, include_old_ath)
