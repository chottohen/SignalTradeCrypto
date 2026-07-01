from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

GENESIS_DATE = pd.Timestamp("2009-01-03")
CACHE_FILE = Path(__file__).parent / "data" / "btc_full_history.csv"
CACHE_TTL_SECONDS = 24 * 3600


def fetch_btc_full_history(force_refresh: bool = False) -> pd.Series:
    """Historique complet du prix BTC (USD) depuis la genese via blockchain.info
    (gratuit, sans cle), pour calibrer la loi de puissance sur toute la vie de
    Bitcoin plutot que sur les seules donnees Binance (listees depuis 08/2017).
    CoinGecko a ete ecarte: son endpoint gratuit limite desormais l'historique
    a 365 jours sans cle API.
    """
    if not force_refresh and CACHE_FILE.exists():
        age = time.time() - CACHE_FILE.stat().st_mtime
        if age < CACHE_TTL_SECONDS:
            df = pd.read_csv(CACHE_FILE, index_col="date", parse_dates=True)
            return df["price"]

    resp = requests.get(
        "https://api.blockchain.info/charts/market-price",
        params={"timespan": "all", "format": "json"},
        timeout=30,
    )
    resp.raise_for_status()
    values = resp.json()["values"]
    df = pd.DataFrame(values)
    df["date"] = pd.to_datetime(df["x"], unit="s").dt.normalize()
    df = df.rename(columns={"y": "price"})
    df = df[df["price"] > 0].drop_duplicates(subset="date").set_index("date")[["price"]]

    CACHE_FILE.parent.mkdir(exist_ok=True)
    df.to_csv(CACHE_FILE, index_label="date")
    return df["price"]


def _days_since_genesis(dates: pd.DatetimeIndex) -> np.ndarray:
    return (dates - GENESIS_DATE).days.to_numpy(dtype=float)


def fit_power_law(prices: pd.Series) -> tuple[float, float, np.ndarray]:
    """Regression log-log: log(prix) = log(A) + n*log(jours depuis la genese).
    Retourne (A, n, residus) ou residus = log(prix reel) - log(prix ajuste).
    """
    days = _days_since_genesis(prices.index)
    log_days = np.log(days)
    log_price = np.log(prices.to_numpy())

    n, log_a = np.polyfit(log_days, log_price, 1)
    a = np.exp(log_a)

    fitted_log_price = log_a + n * log_days
    residuals = log_price - fitted_log_price
    return a, n, residuals


def corridor_position(prices: pd.Series) -> dict:
    """Situe le dernier prix de `prices` dans le corridor de la loi de puissance:
    bande basse/haute definies par les residus extremes observes historiquement
    (enveloppe passant par les creux de capitulation et les sommets d'euphorie).
    """
    a, n, residuals = fit_power_law(prices)

    today_days = (prices.index[-1] - GENESIS_DATE).days
    central_price = a * today_days**n
    lower_band = central_price * np.exp(residuals.min())
    upper_band = central_price * np.exp(residuals.max())

    current_price = float(prices.iloc[-1])
    position_pct = (np.log(current_price) - np.log(lower_band)) / (np.log(upper_band) - np.log(lower_band)) * 100

    if position_pct < 20:
        label = "zone de forte sous-valorisation"
    elif position_pct < 45:
        label = "zone basse"
    elif position_pct < 65:
        label = "corridor median"
    elif position_pct < 85:
        label = "zone haute"
    else:
        label = "zone de forte survalorisation"

    return {
        "date": prices.index[-1],
        "exponent": float(n),
        "current_price": current_price,
        "central_price": float(central_price),
        "lower_band": float(lower_band),
        "upper_band": float(upper_band),
        "position_pct": float(position_pct),
        "label": label,
    }
