from __future__ import annotations

import config
from signal_engine import SignalResult


def apply_risk_management(result: SignalResult, capital: float = config.CAPITAL_TOTAL) -> SignalResult:
    if result.signal not in ("ACHAT", "VENTE"):
        return result

    stop_distance = config.ATR_STOP_MULTIPLIER * result.atr
    if stop_distance <= 0:
        return result

    if result.signal == "ACHAT":
        result.stop_loss = result.close - stop_distance
        result.take_profit = result.close + stop_distance * config.TAKE_PROFIT_RR
    else:
        result.stop_loss = result.close + stop_distance
        result.take_profit = result.close - stop_distance * config.TAKE_PROFIT_RR

    risk_amount = capital * config.RISK_PER_TRADE_PCT
    result.position_size = risk_amount / stop_distance

    max_notional = capital * config.MAX_EXPOSURE_PER_ASSET_PCT
    position_notional = result.position_size * result.close
    if position_notional > max_notional:
        result.position_size = max_notional / result.close

    return result


def enforce_global_exposure(
    results: list[SignalResult], capital: float = config.CAPITAL_TOTAL
) -> list[SignalResult]:
    total_notional = sum(r.position_size * r.close for r in results if r.position_size)
    max_notional = capital * config.MAX_EXPOSURE_GLOBAL_PCT
    if total_notional > max_notional and total_notional > 0:
        scale = max_notional / total_notional
        for r in results:
            if r.position_size:
                r.position_size *= scale
    return results
