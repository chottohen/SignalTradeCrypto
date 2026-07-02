from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

import config
from support_zones import SupportZone, detect_zones_from_weekly, resample_weekly

WARMUP_WEEKS = (config.ZONE_WEEKLY_WINDOW * 2 + 1) * config.ZONE_MIN_TOUCHES + config.ZONE_WEEKLY_WINDOW


@dataclass
class ZonePurchase:
    date: pd.Timestamp
    price: float
    amount: float
    zone_touches: int
    zone_kind: str = "support"


@dataclass
class ZoneDcaResult:
    equity_curve: pd.Series
    purchases: list[ZonePurchase] = field(default_factory=list)
    capital_deployed: float = 0.0
    capital_remaining: float = 0.0

    @property
    def average_cost_basis(self) -> float | None:
        units = sum(p.amount / p.price for p in self.purchases)
        if units == 0:
            return None
        return self.capital_deployed / units


def run_zone_dca(
    df: pd.DataFrame,
    capital: float = config.CAPITAL_TOTAL,
    n_tranches: int = 48,
    include_old_ath: bool = True,
) -> ZoneDcaResult:
    """DCA dynamique: le capital est divise en `n_tranches` parts egales,
    deployees non pas au calendrier mais a chaque fois que le prix (cloture
    hebdomadaire) entre dans une NOUVELLE zone d'interet deja validee par au
    moins `config.ZONE_MIN_TOUCHES` retests. Le capital non deploye reste en
    cash (rendement 0%) jusqu'a la prochaine zone touchee.

    Les zones sont recalculees a chaque semaine en n'utilisant que les
    donnees disponibles jusqu'a cette semaine (pas de lookahead): un support
    ne devient "connu" qu'une fois reellement teste plusieurs fois dans le
    passe, jamais avant.
    """
    df_weekly = resample_weekly(df)
    tranche_size = capital / n_tranches

    cash = capital
    units = 0.0
    tranches_used = 0
    last_zone_center: float | None = None
    purchases: list[ZonePurchase] = []
    equity_curve = {}

    for i in range(len(df_weekly)):
        date = df_weekly.index[i]
        price = float(df_weekly["close"].iloc[i])

        zones: list[SupportZone] = []
        if i >= WARMUP_WEEKS:
            zones = detect_zones_from_weekly(df_weekly.iloc[: i + 1], include_old_ath=include_old_ath)

        current_zone = next((z for z in zones if z.contains(price)), None)

        if current_zone is not None:
            is_new_entry = last_zone_center is None or abs(current_zone.center - last_zone_center) > 1e-9
            if is_new_entry and tranches_used < n_tranches:
                units += tranche_size / price
                cash -= tranche_size
                tranches_used += 1
                purchases.append(ZonePurchase(date, price, tranche_size, current_zone.touches, current_zone.kind))
            last_zone_center = current_zone.center
        else:
            last_zone_center = None

        equity_curve[date] = cash + units * price

    return ZoneDcaResult(
        equity_curve=pd.Series(equity_curve).sort_index(),
        purchases=purchases,
        capital_deployed=tranche_size * len(purchases),
        capital_remaining=cash,
    )
