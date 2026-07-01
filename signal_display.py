from __future__ import annotations

from support_resistance import Level


def nearest_pair(levels: dict[str, list[Level]], current_price: float) -> tuple[Level | None, Level | None]:
    supports = levels.get("support", [])
    resistances = levels.get("resistance", [])
    nearest_support = min(supports, key=lambda l: current_price - l.price) if supports else None
    nearest_resistance = min(resistances, key=lambda l: l.price - current_price) if resistances else None
    return nearest_support, nearest_resistance


def _watch_label(levels: dict[str, list[Level]], current_price: float) -> tuple[str, Level | None]:
    """Precise le libelle A_SURVEILLER selon le niveau le plus proche: RENFORCER
    si un support est plus proche (zone d'opportunite pour ajouter a une position
    existante), ALLEGER si c'est une resistance (zone de prudence, envisager de
    reduire l'exposition). Sans niveau connu des deux cotes, reste A_SURVEILLER.
    """
    nearest_support, nearest_resistance = nearest_pair(levels, current_price)

    support_dist = current_price - nearest_support.price if nearest_support else None
    resistance_dist = nearest_resistance.price - current_price if nearest_resistance else None

    if support_dist is not None and (resistance_dist is None or support_dist <= resistance_dist):
        return "RENFORCER", nearest_support
    if resistance_dist is not None:
        return "ALLEGER", nearest_resistance
    return "A_SURVEILLER", None


def resolve_display_label(signal: str, close: float, levels: dict[str, list[Level]] | None) -> tuple[str, Level | None]:
    if signal != "A_SURVEILLER" or not levels:
        return signal, None
    return _watch_label(levels, close)
