from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

import config
from signal_engine import compute_indicators

REVERSAL_BEARISH = "RETOURNEMENT_BAISSIER"
REVERSAL_BULLISH = "RETOURNEMENT_HAUSSIER"


@dataclass
class TrendAlert:
    symbol: str
    date: pd.Timestamp
    type: str
    close: float
    ema_slow: float
    ema_trend: float
    adx: float
    rationale: str


def detect_trend_reversal_at(symbol: str, df: pd.DataFrame, i: int) -> TrendAlert | None:
    """Detecte un retournement de la tendance de fond (golden/death cross EMA50/EMA200).

    Contrairement au signal tactique (signal_engine), cet indicateur est volontairement
    lent: il ne se declenche que sur un changement de regime majeur, confirme par l'ADX
    pour filtrer les faux croisements en marche sans direction claire.
    """
    if i < 1:
        return None
    last, prev = df.iloc[i], df.iloc[i - 1]

    death_cross = last["ema_slow"] < last["ema_trend"] and prev["ema_slow"] >= prev["ema_trend"]
    golden_cross = last["ema_slow"] > last["ema_trend"] and prev["ema_slow"] <= prev["ema_trend"]
    trending = last["adx"] > config.ADX_TREND_THRESHOLD

    if death_cross and last["close"] < last["ema_trend"] and trending:
        return TrendAlert(
            symbol=symbol,
            date=df.index[i],
            type=REVERSAL_BEARISH,
            close=last["close"],
            ema_slow=last["ema_slow"],
            ema_trend=last["ema_trend"],
            adx=last["adx"],
            rationale=(
                f"Death cross: EMA{config.EMA_SLOW} sous EMA{config.EMA_TREND}, prix sous "
                f"EMA{config.EMA_TREND}, ADX={last['adx']:.1f} > {config.ADX_TREND_THRESHOLD} -> "
                "tendance de fond haussiere terminee, mode preservation du capital."
            ),
        )

    if golden_cross and last["close"] > last["ema_trend"] and trending:
        return TrendAlert(
            symbol=symbol,
            date=df.index[i],
            type=REVERSAL_BULLISH,
            close=last["close"],
            ema_slow=last["ema_slow"],
            ema_trend=last["ema_trend"],
            adx=last["adx"],
            rationale=(
                f"Golden cross: EMA{config.EMA_SLOW} au-dessus EMA{config.EMA_TREND}, prix au-dessus "
                f"EMA{config.EMA_TREND}, ADX={last['adx']:.1f} > {config.ADX_TREND_THRESHOLD} -> "
                "tendance baissiere de fond terminee, reprise d'exposition envisageable."
            ),
        )

    return None


def current_trend_state(df: pd.DataFrame) -> str:
    last = df.iloc[-1]
    return "HAUSSIERE" if last["ema_slow"] > last["ema_trend"] else "BAISSIERE"


def scan_trend_history(symbol: str, df: pd.DataFrame) -> list[TrendAlert]:
    df = compute_indicators(df)
    alerts = []
    for i in range(config.WARMUP_PERIOD, len(df)):
        alert = detect_trend_reversal_at(symbol, df, i)
        if alert:
            alerts.append(alert)
    return alerts
