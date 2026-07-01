from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

import config
from metrics import performance_metrics
from risk_manager import apply_risk_management
from signal_engine import compute_indicators, signal_from_row

WARMUP_PERIOD = config.WARMUP_PERIOD


@dataclass
class Trade:
    symbol: str
    side: str
    entry_date: pd.Timestamp
    entry_price: float
    stop_loss: float
    take_profit: float
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
    def r_multiple(self) -> float:
        risk_amount = abs(self.entry_price - self.stop_loss) * self.size
        if risk_amount == 0 or self.exit_price is None:
            return 0.0
        return self.pnl / risk_amount


@dataclass
class BacktestResult:
    symbol: str
    trades: list[Trade] = field(default_factory=list)
    equity_curve: pd.Series = field(default_factory=pd.Series)

    @property
    def closed_trades(self) -> list[Trade]:
        return [t for t in self.trades if t.exit_price is not None]

    def summary(self) -> dict:
        closed = self.closed_trades
        if not closed:
            return {"symbol": self.symbol, "trades": 0}

        wins = [t for t in closed if t.pnl > 0]
        losses = [t for t in closed if t.pnl <= 0]
        gross_profit = sum(t.pnl for t in wins)
        gross_loss = -sum(t.pnl for t in losses)

        return {
            "symbol": self.symbol,
            **performance_metrics(self.equity_curve),
            "trades": len(closed),
            "taux_de_reussite": len(wins) / len(closed),
            "profit_factor": gross_profit / gross_loss if gross_loss > 0 else float("inf"),
            "r_multiple_moyen": sum(t.r_multiple for t in closed) / len(closed),
        }


def run_backtest(symbol: str, df: pd.DataFrame, capital: float = config.CAPITAL_TOTAL) -> BacktestResult:
    df = compute_indicators(df)
    if len(df) <= WARMUP_PERIOD:
        raise ValueError(f"historique insuffisant: {len(df)} bougies (minimum {WARMUP_PERIOD})")

    equity = capital
    equity_curve = {}
    position: Trade | None = None
    trades: list[Trade] = []

    for i in range(WARMUP_PERIOD, len(df)):
        row = df.iloc[i]
        date = df.index[i]

        if position is not None:
            hit_stop = (
                row["low"] <= position.stop_loss
                if position.side == "ACHAT"
                else row["high"] >= position.stop_loss
            )
            hit_target = (
                row["high"] >= position.take_profit
                if position.side == "ACHAT"
                else row["low"] <= position.take_profit
            )

            if hit_stop:
                position.exit_date, position.exit_price, position.exit_reason = (
                    date,
                    position.stop_loss,
                    "stop_loss",
                )
            elif hit_target:
                position.exit_date, position.exit_price, position.exit_reason = (
                    date,
                    position.take_profit,
                    "take_profit",
                )
            else:
                signal = signal_from_row(symbol, df, i)
                opposite = (position.side == "ACHAT" and signal.signal == "VENTE") or (
                    position.side == "VENTE" and signal.signal == "ACHAT"
                )
                if opposite:
                    position.exit_date, position.exit_price, position.exit_reason = (
                        date,
                        row["close"],
                        "signal_oppose",
                    )

            if position.exit_price is not None:
                equity += position.pnl
                position = None

        if position is None:
            signal = signal_from_row(symbol, df, i)
            if signal.signal in ("ACHAT", "VENTE"):
                risked = apply_risk_management(signal, capital=equity)
                if risked.position_size and risked.position_size > 0:
                    position = Trade(
                        symbol=symbol,
                        side=risked.signal,
                        entry_date=date,
                        entry_price=risked.close,
                        stop_loss=risked.stop_loss,
                        take_profit=risked.take_profit,
                        size=risked.position_size,
                    )
                    trades.append(position)

        unrealized = 0.0
        if position is not None and position.exit_price is None:
            direction = 1 if position.side == "ACHAT" else -1
            unrealized = direction * (row["close"] - position.entry_price) * position.size

        equity_curve[date] = equity + unrealized

    result = BacktestResult(symbol=symbol, trades=trades)
    result.equity_curve = pd.Series(equity_curve).sort_index()
    return result
