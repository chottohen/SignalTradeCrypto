from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

import config
import indicators as ind
import patterns as pat

BULLISH_PATTERNS = {"bullish_engulfing", "morning_star", "hammer"}
BEARISH_PATTERNS = {"bearish_engulfing", "evening_star"}


@dataclass
class SignalResult:
    symbol: str
    signal: str
    close: float
    atr: float
    adx: float
    pattern: str | None
    confirmations_bull: list[str] = field(default_factory=list)
    confirmations_bear: list[str] = field(default_factory=list)
    stop_loss: float | None = None
    take_profit: float | None = None
    position_size: float | None = None
    rationale: str = ""


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["ema_fast"] = ind.ema(df["close"], config.EMA_FAST)
    df["ema_slow"] = ind.ema(df["close"], config.EMA_SLOW)
    df["ema_trend"] = ind.ema(df["close"], config.EMA_TREND)
    df["rsi"] = ind.rsi(df["close"], config.RSI_PERIOD)
    macd_line, signal_line, hist = ind.macd(
        df["close"], config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL
    )
    df["macd"], df["macd_signal"], df["macd_hist"] = macd_line, signal_line, hist
    df["adx"] = ind.adx(df, config.ADX_PERIOD)
    df["atr"] = ind.atr(df, config.ATR_PERIOD)
    df["volume_sma"] = df["volume"].rolling(20).mean()
    return df


def _confluence_at(df: pd.DataFrame, i: int) -> tuple[list[str], list[str], str | None]:
    last, prev = df.iloc[i], df.iloc[i - 1]
    pattern = pat.detect_pattern_at(df, i)

    bull: list[str] = []
    bear: list[str] = []

    if last["ema_fast"] > last["ema_slow"] and prev["ema_fast"] <= prev["ema_slow"]:
        bull.append("croisement_ema_haussier")
    if last["ema_fast"] < last["ema_slow"] and prev["ema_fast"] >= prev["ema_slow"]:
        bear.append("croisement_ema_baissier")
    if last["ema_fast"] > last["ema_slow"] > last["ema_trend"]:
        bull.append("structure_ema_haussiere")
    if last["ema_fast"] < last["ema_slow"] < last["ema_trend"]:
        bear.append("structure_ema_baissiere")

    if pattern in BULLISH_PATTERNS:
        bull.append(f"pattern_{pattern}")
    if pattern in BEARISH_PATTERNS:
        bear.append(f"pattern_{pattern}")

    if 40 < last["rsi"] < 70 and last["rsi"] > prev["rsi"] and prev["rsi"] < 45:
        bull.append("rsi_sortie_survente")
    if 30 < last["rsi"] < 60 and last["rsi"] < prev["rsi"] and prev["rsi"] > 55:
        bear.append("rsi_sortie_surachat")

    if last["macd_hist"] > 0 and prev["macd_hist"] <= 0:
        bull.append("macd_croisement_haussier")
    if last["macd_hist"] < 0 and prev["macd_hist"] >= 0:
        bear.append("macd_croisement_baissier")

    if last["volume"] > last["volume_sma"] * 1.2:
        (bull if last["close"] > last["open"] else bear).append("volume_confirme")

    return bull, bear, pattern


def signal_from_row(symbol: str, df: pd.DataFrame, i: int) -> SignalResult:
    last = df.iloc[i]
    bull, bear, pattern = _confluence_at(df, i)
    trending = last["adx"] > config.ADX_TREND_THRESHOLD

    result = SignalResult(
        symbol=symbol,
        signal="",
        close=last["close"],
        atr=last["atr"],
        adx=last["adx"],
        pattern=pattern,
        confirmations_bull=bull,
        confirmations_bear=bear,
    )

    if trending and len(bull) >= config.MIN_CONFIRMATIONS and len(bull) > len(bear):
        result.signal = "ACHAT"
    elif trending and len(bear) >= config.MIN_CONFIRMATIONS and len(bear) > len(bull):
        result.signal = "VENTE"
    elif not trending and pattern is None:
        result.signal = "CALME"
    else:
        result.signal = "A_SURVEILLER"

    result.rationale = _build_rationale(result)
    return result


def evaluate(symbol: str, df: pd.DataFrame) -> SignalResult:
    df = compute_indicators(df)
    return signal_from_row(symbol, df, len(df) - 1)


def _build_rationale(r: SignalResult) -> str:
    if r.signal == "ACHAT":
        return f"Confluence haussiere ({', '.join(r.confirmations_bull)}), ADX={r.adx:.1f}"
    if r.signal == "VENTE":
        return f"Confluence baissiere ({', '.join(r.confirmations_bear)}), ADX={r.adx:.1f}"
    if r.signal == "CALME":
        return f"ADX={r.adx:.1f} sous le seuil de tendance, aucune figure significative"
    return (
        f"Signaux insuffisants ou contradictoires "
        f"(haussier={len(r.confirmations_bull)}, baissier={len(r.confirmations_bear)}), a confirmer"
    )
