from __future__ import annotations

import math


def format_price(value: float) -> str:
    """Formate un prix avec assez de decimales pour rester lisible sur les
    tokens a tres faible valeur unitaire (ex: PEPE, SHIB a 0.000009)."""
    if not value:
        return "0.00"
    magnitude = abs(value)
    if magnitude >= 1:
        return f"{value:,.2f}".replace(",", " ")
    decimals = max(2, 3 - int(math.floor(math.log10(magnitude))))
    return f"{value:.{decimals}f}"
