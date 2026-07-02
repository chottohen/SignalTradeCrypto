import pandas as pd

import config
from chart_patterns import latest_confirmed_pattern
from data_fetcher import fetch_ohlcv
from fundamental_filter import fundamental_context
from historical_data import fetch_history
from html_report import build_html_report
from power_law import corridor_position, fetch_btc_full_history
from report import build_report
from risk_manager import apply_risk_management, enforce_global_exposure
from signal_engine import compute_indicators, evaluate
from support_resistance import analyze_symbol
from supertrend import current_status as supertrend_status
from trend_regime import current_trend_state, detect_trend_reversal_at
from universe import get_watchlist
from variations import compute_variations


def run_daily_scan() -> tuple[str, str]:
    fundamentals = fundamental_context()
    now = pd.Timestamp.now("UTC").tz_localize(None)
    watchlist = get_watchlist(config.WATCHLIST_SIZE)

    try:
        power_law_info = corridor_position(fetch_btc_full_history())
    except Exception as exc:
        print(f"Loi de puissance BTC indisponible: {exc}")
        power_law_info = None

    results = []
    trend_info = {}
    levels_info = {}
    variations_info = {}
    supertrend_info = {}
    chart_pattern_info = {}
    for symbol in watchlist:
        try:
            df = fetch_ohlcv(symbol, config.TIMEFRAME, config.CANDLES_HISTORY)
            if len(df) <= config.WARMUP_PERIOD:
                print(f"{symbol}: historique insuffisant ({len(df)} bougies), ignore")
                continue

            result = evaluate(symbol, df)
            result = apply_risk_management(result)
            results.append(result)

            df_ind = compute_indicators(df)
            trend_info[symbol] = {
                "state": current_trend_state(df_ind),
                "alert": detect_trend_reversal_at(symbol, df_ind, len(df_ind) - 1),
            }
            supertrend_info[symbol] = supertrend_status(df)

            df_long = fetch_history(
                symbol, config.TIMEFRAME, now - pd.Timedelta(days=config.SR_LONG_TERM_LOOKBACK_DAYS)
            )
            df_medium = df_long[df_long.index >= now - pd.Timedelta(days=config.SR_MEDIUM_TERM_LOOKBACK_DAYS)]
            levels_info[symbol] = analyze_symbol(df_medium, df_long)
            variations_info[symbol] = compute_variations(df_long)
            chart_pattern_info[symbol] = latest_confirmed_pattern(df_long)
        except Exception as exc:
            print(f"{symbol}: erreur ignoree ({exc})")
            continue

    results = enforce_global_exposure(results)
    markdown = build_report(
        results,
        fundamentals,
        trend_info,
        levels_info,
        power_law_info,
        supertrend_info,
        chart_pattern_info,
        variations_info,
    )
    html = build_html_report(
        results,
        fundamentals,
        trend_info,
        levels_info,
        variations_info,
        power_law_info,
        supertrend_info,
        chart_pattern_info,
    )
    return markdown, html


if __name__ == "__main__":
    markdown_report, html_report = run_daily_scan()
    print(markdown_report)
    with open("rapport_du_jour.md", "w", encoding="utf-8") as f:
        f.write(markdown_report)
    with open("rapport_du_jour.html", "w", encoding="utf-8") as f:
        f.write(html_report)
