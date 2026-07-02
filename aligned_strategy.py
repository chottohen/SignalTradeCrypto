from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

import config
from signal_engine import compute_indicators, signal_from_row
from supertrend import compute_supertrend


@dataclass
class AlignedTrade:
    entry_date: pd.Timestamp
    exit_date: pd.Timestamp
    entry_price: float
    exit_price: float

    @property
    def return_pct(self) -> float:
        return (self.exit_price / self.entry_price - 1) * 100


@dataclass
class AlignedBacktestResult:
    equity_curve: pd.Series
    trades: list[AlignedTrade] = field(default_factory=list)
    time_invested_pct: float = 0.0


def run_aligned_backtest(
    symbol: str,
    df: pd.DataFrame,
    capital: float = config.CAPITAL_TOTAL,
    warmup: int = config.WARMUP_PERIOD,
) -> AlignedBacktestResult:
    """Strategie binaire tout-ou-rien: 100% investi quand le signal tactique
    (confluence haussiere strictement superieure a la baissiere, sans le
    filtre ADX de signal_engine) ET le Supertrend sont tous les deux
    haussiers ('alignes'), 100% cash sinon. Pas de stop-loss/take-profit
    distinct: l'exposition suit uniquement l'alignement des deux indicateurs.
    """
    df_signal = compute_indicators(df)
    df_st = compute_supertrend(df)

    if len(df_signal) <= warmup:
        raise ValueError(f"historique insuffisant: {len(df_signal)} bougies (minimum {warmup})")

    equity = capital
    units = 0.0
    invested = False
    entry_date = None
    entry_price = None
    equity_curve = {}
    trades: list[AlignedTrade] = []
    invested_days = 0

    for i in range(warmup, len(df_signal)):
        date = df_signal.index[i]
        close = float(df_signal["close"].iloc[i])

        sig = signal_from_row(symbol, df_signal, i)
        tactical_bullish = len(sig.confirmations_bull) > len(sig.confirmations_bear)
        st_bullish = bool(df_st["supertrend_bullish"].iloc[i])
        aligned_bullish = tactical_bullish and st_bullish

        if not invested and aligned_bullish:
            units = equity / close
            invested = True
            entry_date, entry_price = date, close
        elif invested and not aligned_bullish:
            equity = units * close
            trades.append(AlignedTrade(entry_date, date, entry_price, close))
            units = 0.0
            invested = False

        if invested:
            invested_days += 1
        equity_curve[date] = units * close if invested else equity

    if invested:
        final_close = float(df_signal["close"].iloc[-1])
        trades.append(AlignedTrade(entry_date, df_signal.index[-1], entry_price, final_close))

    total_days = len(df_signal) - warmup
    time_invested_pct = (invested_days / total_days * 100) if total_days > 0 else 0.0

    return AlignedBacktestResult(
        equity_curve=pd.Series(equity_curve).sort_index(),
        trades=trades,
        time_invested_pct=time_invested_pct,
    )
