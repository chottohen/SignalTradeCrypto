from __future__ import annotations

from datetime import date

from formatting import format_price
from signal_engine import SignalResult
from signal_display import nearest_pair, resolve_display_label
from support_resistance import Level
from trend_regime import TrendAlert

LABEL_STYLE = {
    "ACHAT": {"text": "Achat", "bg": "#EAF3DE", "color": "#173404", "border": None},
    "VENTE": {"text": "Vente", "bg": "#FCEBEB", "color": "#501313", "border": None},
    "CALME": {"text": "Calme", "bg": "#F1EFE8", "color": "#2C2C2A", "border": None},
    "ALLEGER": {"text": "Alléger", "bg": "#FAEEDA", "color": "#412402", "border": None},
    "RENFORCER": {"text": "Renforcer", "bg": "#FFFFFF", "color": "#173404", "border": "#3B6D11"},
    "A_SURVEILLER": {"text": "A surveiller", "bg": "#FFFFFF", "color": "#2C2C2A", "border": "#888780"},
}

GREEN, RED, AMBER, GRAY = "#3B6D11", "#A32D2D", "#854F0B", "#5F5E5A"

STYLE = """
body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; background: #F1EFE8; margin: 0; padding: 24px; color: #2C2C2A; }
.container { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.subtitle { font-size: 13px; color: #5F5E5A; margin: 0 0 20px; }
.section-title { font-size: 15px; font-weight: 600; margin: 24px 0 10px; }
.macro-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
.macro-chip { background: #FFFFFF; border: 1px solid #E3E1D8; border-radius: 8px; padding: 8px 14px; font-size: 13px; }
.trend-list { background: #FFFFFF; border: 1px solid #E3E1D8; border-radius: 10px; padding: 6px 14px; font-size: 13px; }
.trend-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #F1EFE8; }
.trend-row:last-child { border-bottom: none; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
.card { background: #FFFFFF; border: 1px solid #E3E1D8; border-radius: 12px; padding: 16px 18px; }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.symbol { font-size: 16px; font-weight: 600; margin: 0; }
.price { font-size: 13px; color: #5F5E5A; margin: 2px 0 0; }
.badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 6px; white-space: nowrap; }
.rationale { font-size: 13px; color: #5F5E5A; margin: 0 0 10px; line-height: 1.5; }
.alert-box { border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; font-size: 12px; line-height: 1.4; }
.variations { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; border-top: 1px solid #F1EFE8; padding: 10px 0; }
.var-label { font-size: 12px; color: #5F5E5A; margin: 0 0 2px; }
.var-value { font-size: 14px; font-weight: 600; margin: 0; }
.level-block { padding: 8px 0 0; }
.level-block.bordered { border-top: 1px solid #F1EFE8; padding-top: 10px; }
.level-top { display: flex; justify-content: space-between; align-items: baseline; }
.level-label { font-size: 13px; margin: 0; }
.level-price { font-size: 14px; font-weight: 600; margin: 0; }
.level-meta { font-size: 12px; margin: 2px 0 0; text-align: right; }
.footer { margin-top: 24px; font-size: 12px; color: #5F5E5A; }
"""


def _badge_html(label: str) -> str:
    style = LABEL_STYLE.get(label, LABEL_STYLE["A_SURVEILLER"])
    border_css = f"border:1px solid {style['border']};" if style["border"] else "border:none;"
    return (
        f'<span class="badge" style="background:{style["bg"]};color:{style["color"]};{border_css}">'
        f'{style["text"]}</span>'
    )


def _variation_cell(label: str, value: float | None) -> str:
    if value is None:
        return f'<div><p class="var-label">{label}</p><p class="var-value" style="color:{GRAY};">n/d</p></div>'
    if abs(value) < 0.1:
        color, arrow = GRAY, "▪"
    elif value > 0:
        color, arrow = GREEN, "▲"
    else:
        color, arrow = RED, "▼"
    return f'<div><p class="var-label">{label}</p><p class="var-value" style="color:{color};">{arrow} {abs(value):.1f}%</p></div>'


def _level_block_html(kind_label: str, level: Level | None, current_price: float, highlight_color: str | None, bordered: bool) -> str:
    if level is None:
        return ""
    distance_pct = (level.price - current_price) / current_price * 100
    distance_abs = level.price - current_price
    days = (date.today() - level.last_touch.date()).days
    color = highlight_color or "#2C2C2A"
    meta_color = highlight_color or "#5F5E5A"
    weight = "600" if highlight_color else "400"
    sign = "+" if distance_abs >= 0 else "-"
    css_class = "level-block bordered" if bordered else "level-block"
    return f"""
    <div class="{css_class}">
      <div class="level-top">
        <p class="level-label" style="color:{color};font-weight:{weight};">{kind_label}</p>
        <p class="level-price">{format_price(level.price)}</p>
      </div>
      <p class="level-meta" style="color:{meta_color};">{distance_pct:+.1f}% ({sign}{format_price(abs(distance_abs))}) · touché il y a {days} j</p>
    </div>"""


def _card_html(
    r: SignalResult,
    trend_entry: dict[str, object] | None,
    levels: dict[str, list[Level]] | None,
    variations: dict[str, float | None] | None,
) -> str:
    display_label, watch_level = resolve_display_label(r.signal, r.close, levels)
    nearest_support, nearest_resistance = nearest_pair(levels, r.close) if levels else (None, None)

    support_color = GREEN if watch_level is nearest_support and display_label == "RENFORCER" else None
    resistance_color = AMBER if watch_level is nearest_resistance and display_label == "ALLEGER" else None

    alert_html = ""
    alert: TrendAlert | None = trend_entry.get("alert") if trend_entry else None
    if alert:
        alert_html = (
            f'<div class="alert-box" style="background:#FCEBEB;color:#501313;">'
            f"⚠ {alert.rationale}</div>"
        )

    variations = variations or {}
    variations_html = (
        '<div class="variations">'
        + _variation_cell("Veille", variations.get("d1"))
        + _variation_cell("7 jours", variations.get("d7"))
        + _variation_cell("30 jours", variations.get("d30"))
        + "</div>"
    )

    resistance_html = _level_block_html("Résistance", nearest_resistance, r.close, resistance_color, bordered=True)
    support_html = _level_block_html("Support", nearest_support, r.close, support_color, bordered=False)

    extra_note = ""
    if display_label == "RENFORCER" and watch_level:
        extra_note = f'<p class="rationale">Prix proche d\'un support ({watch_level.horizon}) — zone d\'opportunité pour ajouter à une position existante.</p>'
    elif display_label == "ALLEGER" and watch_level:
        extra_note = f'<p class="rationale">Prix proche d\'une résistance ({watch_level.horizon}) — zone de prudence, envisager de réduire l\'exposition.</p>'

    return f"""
  <div class="card">
    <div class="card-header">
      <div>
        <p class="symbol">{r.symbol}</p>
        <p class="price">{format_price(r.close)} USDT</p>
      </div>
      {_badge_html(display_label)}
    </div>
    <p class="rationale">{r.rationale}</p>
    {extra_note}
    {alert_html}
    {variations_html}
    {resistance_html}
    {support_html}
  </div>"""


def build_html_report(
    results: list[SignalResult],
    fundamentals: dict,
    trend_info: dict[str, dict[str, object]] | None = None,
    levels_info: dict[str, dict[str, list[Level]]] | None = None,
    variations_info: dict[str, dict[str, float | None]] | None = None,
) -> str:
    trend_info = trend_info or {}
    levels_info = levels_info or {}
    variations_info = variations_info or {}

    dom = fundamentals.get("btc_dominance")
    fg = fundamentals.get("fear_greed")
    macro_html = '<div class="macro-row">'
    macro_html += f'<div class="macro-chip">Dominance BTC : {dom:.2f}%</div>' if dom is not None else '<div class="macro-chip">Dominance BTC : indisponible</div>'
    if fg:
        macro_html += f'<div class="macro-chip">Fear &amp; Greed : {fg["value"]} ({fg["classification"]})</div>'
    else:
        macro_html += '<div class="macro-chip">Fear &amp; Greed : indisponible</div>'
    macro_html += "</div>"

    trend_html = ""
    if trend_info:
        rows = []
        for symbol, info in trend_info.items():
            alert: TrendAlert | None = info.get("alert")
            state = info.get("state")
            if alert:
                rows.append(f'<div class="trend-row"><span>{symbol}</span><span style="color:{RED};font-weight:600;">ALERTE {alert.type}</span></div>')
            else:
                color = GREEN if state == "HAUSSIERE" else RED
                rows.append(f'<div class="trend-row"><span>{symbol}</span><span style="color:{color};">{state.lower()}</span></div>')
        trend_html = f'<p class="section-title">Tendance de fond</p><div class="trend-list">{"".join(rows)}</div>'

    cards_html = "".join(
        _card_html(r, trend_info.get(r.symbol), levels_info.get(r.symbol), variations_info.get(r.symbol))
        for r in results
    )

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport quotidien - {date.today().isoformat()}</title>
<style>{STYLE}</style>
</head>
<body>
<div class="container">
  <h1>Rapport quotidien</h1>
  <p class="subtitle">{date.today().isoformat()}</p>
  {macro_html}
  {trend_html}
  <p class="section-title">Signaux par actif</p>
  <div class="grid">{cards_html}</div>
  <p class="footer">Outil d'aide à la décision. Ne constitue pas un conseil financier. Aucune position ne doit être ouverte sans supervision humaine et backtest préalable.</p>
</div>
</body>
</html>"""
