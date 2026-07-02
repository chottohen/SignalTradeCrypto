from __future__ import annotations

from datetime import date

from chart_patterns import DoublePattern
from formatting import format_price
from signal_engine import SignalResult
from signal_display import resolve_display_label
from support_resistance import Level
from supertrend import SupertrendStatus
from trend_regime import TrendAlert


def _format_levels(levels: list[Level], current_price: float, highlight: Level | None = None) -> list[str]:
    lines = []
    for lvl in sorted(levels, key=lambda l: l.price):
        distance_pct = (lvl.price - current_price) / current_price * 100
        marker = "  -> " if lvl is highlight else "  - "
        lines.append(
            f"{marker}{lvl.kind} {lvl.horizon} a {format_price(lvl.price)} ({distance_pct:+.1f}%), "
            f"{lvl.touches} touche(s), dernier test {lvl.last_touch.date()}"
        )
    return lines


def build_report(
    results: list[SignalResult],
    fundamentals: dict,
    trend_info: dict[str, dict[str, object]] | None = None,
    levels_info: dict[str, dict[str, list[Level]]] | None = None,
    power_law_info: dict | None = None,
    supertrend_info: dict[str, SupertrendStatus] | None = None,
    chart_pattern_info: dict[str, DoublePattern | None] | None = None,
) -> str:
    lines = [f"# Rapport quotidien - {date.today().isoformat()}", ""]

    dom = fundamentals.get("btc_dominance")
    fg = fundamentals.get("fear_greed")
    lines.append("## Contexte macro")
    lines.append(f"- Dominance BTC: {dom:.2f}%" if dom is not None else "- Dominance BTC: indisponible")
    if fg:
        lines.append(f"- Fear & Greed Index: {fg['value']} ({fg['classification']})")
    else:
        lines.append("- Fear & Greed Index: indisponible")
    lines.append("")

    if power_law_info:
        lines.append("## Loi de puissance BTC (contexte long terme)")
        lines.append(
            f"- Position dans le corridor: {power_law_info['position_pct']:.0f}% "
            f"({power_law_info['label']})"
        )
        lines.append(f"- Prix actuel: {format_price(power_law_info['current_price'])}")
        lines.append(f"- Ligne centrale du jour: {format_price(power_law_info['central_price'])}")
        lines.append(
            f"- Bande basse: {format_price(power_law_info['lower_band'])} | "
            f"Bande haute: {format_price(power_law_info['upper_band'])}"
        )
        lines.append(
            f"- Exposant ajuste: {power_law_info['exponent']:.2f} "
            "(indicatif, ajuste sur l'historique BTC depuis 2010, pas un signal de trading)"
        )
        lines.append("")

    if trend_info:
        lines.append("## Tendance de fond (preservation du capital)")
        for symbol, info in trend_info.items():
            alert: TrendAlert | None = info.get("alert")
            state = info.get("state")
            if alert:
                lines.append(f"- {symbol}: **ALERTE {alert.type}** — {alert.rationale}")
            else:
                lines.append(f"- {symbol}: tendance de fond {state.lower()}, pas de retournement aujourd'hui")
        lines.append("")

    lines.append("## Signaux par actif")
    for r in results:
        symbol_levels_dict = levels_info.get(r.symbol) if levels_info else None
        display_label, watch_level = resolve_display_label(r.signal, r.close, symbol_levels_dict)

        lines.append(f"### {r.symbol} — **{display_label}**")
        lines.append(f"- Prix: {format_price(r.close)}")
        lines.append(f"- ADX: {r.adx:.1f} | Pattern detecte: {r.pattern or 'aucun'}")
        st: SupertrendStatus | None = supertrend_info.get(r.symbol) if supertrend_info else None
        if st:
            flip_note = " (retournement aujourd'hui)" if st.flipped_today else ""
            lines.append(
                f"- Supertrend (suivi serre): {st.direction} depuis {st.days_in_direction} j, "
                f"ligne a {format_price(st.line)}{flip_note}"
            )
        pattern: DoublePattern | None = chart_pattern_info.get(r.symbol) if chart_pattern_info else None
        if pattern:
            lines.append(f"- Figure chartiste: {pattern.rationale}")
        lines.append(f"- Rationale: {r.rationale}")
        if display_label == "RENFORCER":
            lines.append(
                f"- Renforcer: prix proche d'un support ({watch_level.horizon}) — "
                "zone d'opportunite pour ajouter a une position existante, sous reserve de confirmation."
            )
        elif display_label == "ALLEGER":
            lines.append(
                f"- Alleger: prix proche d'une resistance ({watch_level.horizon}) — "
                "zone de prudence, envisager de reduire l'exposition existante."
            )
        if r.signal in ("ACHAT", "VENTE"):
            lines.append(f"- Stop-loss: {format_price(r.stop_loss)}")
            lines.append(f"- Take-profit: {format_price(r.take_profit)}")
            lines.append(f"- Taille de position suggeree: {r.position_size:.6f} unites")
        if symbol_levels_dict:
            lines.append("- Support/resistance a surveiller pour retournement:")
            symbol_levels = symbol_levels_dict["support"] + symbol_levels_dict["resistance"]
            lines.extend(_format_levels(symbol_levels, r.close, highlight=watch_level))
        lines.append("")

    lines.append("---")
    lines.append(
        "Outil d'aide a la decision. Ne constitue pas un conseil financier. "
        "Aucune position ne doit etre ouverte sans supervision humaine et backtest prealable."
    )
    return "\n".join(lines)
