from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

import config
from signal_engine import SignalResult, compute_indicators, signal_from_row
from supertrend import compute_supertrend

# Reglage classique (14, 3.0), volontairement plus lache que le suivi serre
# informatif (10, 2.0) de config.SUPERTREND_*: ici il sert de sortie de
# tendance, pas d'indicateur reactif, pour eviter les fausses sorties.
SWING_SUPERTREND_PERIOD = 14
SWING_SUPERTREND_MULTIPLIER = 3.0


@dataclass
class SwingTrade:
    side: str
    entry_date: pd.Timestamp
    entry_price: float
    entry_risk_distance: float
    size: float
    exit_date: pd.Timestamp | None = None
    exit_price: float | None = None
    exit_reason: str | None = None

    @property
    def pnl(self) -> float:
        if self.exit_price is None:
            return 0.0
        direction = 1 if self.side == "ACHAT" else -1
        return direction * (self.exit_price - self.entry_price) * self.size

    @property
    def return_pct(self) -> float:
        if self.exit_price is None:
            return 0.0
        direction = 1 if self.side == "ACHAT" else -1
        return direction * (self.exit_price / self.entry_price - 1) * 100

    @property
    def duration_days(self) -> int:
        if self.exit_date is None:
            return 0
        return (self.exit_date - self.entry_date).days


@dataclass
class SwingBacktestResult:
    equity_curve: pd.Series
    trades: list[SwingTrade] = field(default_factory=list)

    @property
    def closed_trades(self) -> list[SwingTrade]:
        return [t for t in self.trades if t.exit_price is not None]


def run_swing_backtest(
    symbol: str,
    df: pd.DataFrame,
    capital: float = config.CAPITAL_TOTAL,
    warmup: int = config.WARMUP_PERIOD,
) -> SwingBacktestResult:
    """Strategie swing multi-jours/semaines: entree uniquement sur un signal
    tactique complet (ACHAT/VENTE de signal_engine, donc confluence +
    filtre ADX deja appliques - pas la simple majorite de aligned_strategy)
    QUAND le Supertrend large est deja dans le meme sens (aligne des
    l'entree). Sans cette exigence, un signal tactique plus rapide que le
    Supertrend large declenchait une sortie des le lendemain (retournement
    immediat), ce qui donnait une duree mediane de trade de 1 jour au lieu
    du swing multi-jours recherche.

    Un seul mecanisme de sortie, volontairement unique: le Supertrend large
    (14, 3.0) sert a la fois de reference de risque a l'entree (pour
    dimensionner la position a 1% de capital risque) et de sortie suiveuse.
    Un stop dur serre (ATR_STOP_MULTIPLIER, calibre pour le signal tactique
    court terme) a ete teste en complement mais degrade le resultat: il coupe
    les positions avant que la tendance multi-semaines ait le temps de se
    confirmer (taux de reussite tombe de ~32% a ~22%, rendement negatif sur
    2 des 3 periodes testees). Un stop calibre pour des trades courts n'est
    pas adapte a une strategie visant des trades de plusieurs semaines.
    """
    df_signal = compute_indicators(df)
    df_st = compute_supertrend(df, SWING_SUPERTREND_PERIOD, SWING_SUPERTREND_MULTIPLIER)

    if len(df_signal) <= warmup:
        raise ValueError(f"historique insuffisant: {len(df_signal)} bougies (minimum {warmup})")

    equity = capital
    position: SwingTrade | None = None
    trades: list[SwingTrade] = []
    equity_curve = {}

    for i in range(warmup, len(df_signal)):
        date = df_signal.index[i]
        row = df_signal.iloc[i]
        st_bullish = bool(df_st["supertrend_bullish"].iloc[i])

        if position is not None:
            trend_flipped = (position.side == "ACHAT" and not st_bullish) or (
                position.side == "VENTE" and st_bullish
            )
            if trend_flipped:
                position.exit_date, position.exit_price, position.exit_reason = (
                    date,
                    float(row["close"]),
                    "retournement_supertrend",
                )
                equity += position.pnl
                position = None

        if position is None:
            sig: SignalResult = signal_from_row(symbol, df_signal, i)
            aligned_at_entry = (sig.signal == "ACHAT" and st_bullish) or (sig.signal == "VENTE" and not st_bullish)
            if sig.signal in ("ACHAT", "VENTE") and aligned_at_entry:
                entry_price = float(row["close"])
                st_line = float(df_st["supertrend_line"].iloc[i])
                risk_distance = abs(entry_price - st_line)

                if risk_distance > 0:
                    risk_amount = equity * config.RISK_PER_TRADE_PCT
                    size = risk_amount / risk_distance
                    max_notional = equity * config.MAX_EXPOSURE_PER_ASSET_PCT
                    if size * entry_price > max_notional:
                        size = max_notional / entry_price

                    position = SwingTrade(
                        side=sig.signal,
                        entry_date=date,
                        entry_price=entry_price,
                        entry_risk_distance=risk_distance,
                        size=size,
                    )
                    trades.append(position)

        unrealized = 0.0
        if position is not None and position.exit_price is None:
            direction = 1 if position.side == "ACHAT" else -1
            unrealized = direction * (float(row["close"]) - position.entry_price) * position.size
        equity_curve[date] = equity + unrealized

    return SwingBacktestResult(equity_curve=pd.Series(equity_curve).sort_index(), trades=trades)
