# Fallback statique utilise si universe.get_watchlist() echoue sans cache disponible
WATCHLIST = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
WATCHLIST_SIZE = 50  # top N par capitalisation, hors stablecoins (voir universe.py)
TIMEFRAME = "1d"
CANDLES_HISTORY = 250

CAPITAL_TOTAL = 10_000.0
RISK_PER_TRADE_PCT = 0.01
MAX_EXPOSURE_PER_ASSET_PCT = 0.20
MAX_EXPOSURE_GLOBAL_PCT = 0.60

EMA_FAST = 20
EMA_SLOW = 50
EMA_TREND = 200
WARMUP_PERIOD = EMA_TREND + 10

RSI_PERIOD = 14
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9

ADX_PERIOD = 14
ADX_TREND_THRESHOLD = 20

ATR_PERIOD = 14
ATR_STOP_MULTIPLIER = 1.5
TAKE_PROFIT_RR = 2.0

MIN_CONFIRMATIONS = 2

SR_TOLERANCE_PCT = 0.02
SR_LEVELS_PER_SIDE = 2
SR_MEDIUM_TERM_WINDOW = 10
SR_MEDIUM_TERM_LOOKBACK_DAYS = 365
SR_LONG_TERM_WINDOW = 30
SR_LONG_TERM_LOOKBACK_DAYS = 1825

# Parametres resserres par rapport au reglage classique (10, 3.0) pour un
# suivi de tendance plus reactif, complementaire au golden/death cross lent
# de trend_regime.py.
SUPERTREND_PERIOD = 10
SUPERTREND_MULTIPLIER = 2.0
