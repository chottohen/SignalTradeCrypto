from __future__ import annotations

import pandas as pd


def _body(row: pd.Series) -> float:
    return abs(row["close"] - row["open"])


def _range(row: pd.Series) -> float:
    return row["high"] - row["low"]


def _is_bullish(row: pd.Series) -> bool:
    return row["close"] > row["open"]


def is_doji(row: pd.Series, threshold: float = 0.1) -> bool:
    r = _range(row)
    return r > 0 and _body(row) / r < threshold


def is_hammer(row: pd.Series, wick_ratio: float = 2.0) -> bool:
    lower_wick = min(row["open"], row["close"]) - row["low"]
    upper_wick = row["high"] - max(row["open"], row["close"])
    b = _body(row)
    return b > 0 and lower_wick > wick_ratio * b and upper_wick < b


def is_bullish_engulfing(prev: pd.Series, curr: pd.Series) -> bool:
    return (
        not _is_bullish(prev)
        and _is_bullish(curr)
        and curr["open"] <= prev["close"]
        and curr["close"] >= prev["open"]
    )


def is_bearish_engulfing(prev: pd.Series, curr: pd.Series) -> bool:
    return (
        _is_bullish(prev)
        and not _is_bullish(curr)
        and curr["open"] >= prev["close"]
        and curr["close"] <= prev["open"]
    )


def is_morning_star(c1: pd.Series, c2: pd.Series, c3: pd.Series) -> bool:
    return (
        not _is_bullish(c1)
        and _body(c2) < _body(c1) * 0.5
        and _is_bullish(c3)
        and c3["close"] > (c1["open"] + c1["close"]) / 2
    )


def is_evening_star(c1: pd.Series, c2: pd.Series, c3: pd.Series) -> bool:
    return (
        _is_bullish(c1)
        and _body(c2) < _body(c1) * 0.5
        and not _is_bullish(c3)
        and c3["close"] < (c1["open"] + c1["close"]) / 2
    )


def detect_pattern_at(df: pd.DataFrame, i: int) -> str | None:
    if i < 2:
        return None
    c1, c2, c3 = df.iloc[i - 2], df.iloc[i - 1], df.iloc[i]
    if is_bullish_engulfing(c2, c3):
        return "bullish_engulfing"
    if is_bearish_engulfing(c2, c3):
        return "bearish_engulfing"
    if is_morning_star(c1, c2, c3):
        return "morning_star"
    if is_evening_star(c1, c2, c3):
        return "evening_star"
    if is_hammer(c3):
        return "hammer"
    if is_doji(c3):
        return "doji"
    return None
