from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

import config
import indicators as ind


def compute_supertrend(
    df: pd.DataFrame,
    period: int = config.SUPERTREND_PERIOD,
    multiplier: float = config.SUPERTREND_MULTIPLIER,
) -> pd.DataFrame:
    """Supertrend classique: bande ATR autour du prix (hl2 +/- multiplier*ATR)
    qui bascule haussier/baissier au franchissement de cloture. Contrairement
    au golden/death cross de trend_regime.py (lent, EMA50/200), c'est un suivi
    de tendance reactif qui colle de pres au prix.
    """
    df = df.copy()
    atr = ind.atr(df, period)
    hl2 = (df["high"] + df["low"]) / 2
    basic_upper = (hl2 + multiplier * atr).to_numpy()
    basic_lower = (hl2 - multiplier * atr).to_numpy()
    close = df["close"].to_numpy()
    n = len(df)

    final_upper = basic_upper.copy()
    final_lower = basic_lower.copy()
    bullish = np.full(n, True)
    line = np.full(n, np.nan)

    for i in range(1, n):
        final_upper[i] = (
            basic_upper[i]
            if basic_upper[i] < final_upper[i - 1] or close[i - 1] > final_upper[i - 1]
            else final_upper[i - 1]
        )
        final_lower[i] = (
            basic_lower[i]
            if basic_lower[i] > final_lower[i - 1] or close[i - 1] < final_lower[i - 1]
            else final_lower[i - 1]
        )
        bullish[i] = (close[i] >= final_lower[i]) if bullish[i - 1] else (close[i] > final_upper[i])
        line[i] = final_lower[i] if bullish[i] else final_upper[i]

    df["supertrend_line"] = line
    df["supertrend_bullish"] = bullish
    return df


@dataclass
class SupertrendStatus:
    direction: str  # "HAUSSIER" | "BAISSIER"
    line: float
    close: float
    flipped_today: bool
    days_in_direction: int


def current_status(
    df: pd.DataFrame,
    period: int = config.SUPERTREND_PERIOD,
    multiplier: float = config.SUPERTREND_MULTIPLIER,
) -> SupertrendStatus:
    df = compute_supertrend(df, period, multiplier)
    bullish = df["supertrend_bullish"]
    last = df.iloc[-1]

    flipped_today = len(bullish) > 1 and bool(bullish.iloc[-1]) != bool(bullish.iloc[-2])

    current_dir = bullish.iloc[-1]
    days_in_direction = 1
    for i in range(len(bullish) - 2, -1, -1):
        if bullish.iloc[i] != current_dir:
            break
        days_in_direction += 1

    return SupertrendStatus(
        direction="HAUSSIER" if bool(last["supertrend_bullish"]) else "BAISSIER",
        line=float(last["supertrend_line"]),
        close=float(last["close"]),
        flipped_today=flipped_today,
        days_in_direction=days_in_direction,
    )
