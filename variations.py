from __future__ import annotations

import pandas as pd


def compute_variations(df: pd.DataFrame) -> dict[str, float | None]:
    close = df["close"]
    n = len(close)

    def pct_change(periods: int) -> float | None:
        if n <= periods:
            return None
        return (close.iloc[-1] / close.iloc[-1 - periods] - 1) * 100

    return {"d1": pct_change(1), "d7": pct_change(7), "d30": pct_change(30)}
