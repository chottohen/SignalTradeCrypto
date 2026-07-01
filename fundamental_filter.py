from __future__ import annotations

import requests


def get_btc_dominance() -> float | None:
    try:
        resp = requests.get("https://api.coingecko.com/api/v3/global", timeout=10)
        resp.raise_for_status()
        return resp.json()["data"]["market_cap_percentage"]["btc"]
    except Exception:
        return None


def get_fear_greed_index() -> dict | None:
    try:
        resp = requests.get("https://api.alternative.me/fng/?limit=1", timeout=10)
        resp.raise_for_status()
        data = resp.json()["data"][0]
        return {"value": int(data["value"]), "classification": data["value_classification"]}
    except Exception:
        return None


def fundamental_context() -> dict:
    return {
        "btc_dominance": get_btc_dominance(),
        "fear_greed": get_fear_greed_index(),
    }
