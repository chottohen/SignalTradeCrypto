// Port de signal_engine.py + risk_manager.py

function computeIndicators(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const emaFastArr = ema(closes, CONFIG.emaFast);
  const emaSlowArr = ema(closes, CONFIG.emaSlow);
  const emaTrendArr = ema(closes, CONFIG.emaTrend);
  const rsiArr = rsi(closes, CONFIG.rsiPeriod);
  const { macdLine, signalLine, histogram } = macd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);
  const adxArr = adx(candles, CONFIG.adxPeriod);
  const atrArr = atr(candles, CONFIG.atrPeriod);
  const volumeSmaArr = sma(volumes, 20);

  return candles.map((c, i) => ({
    ...c,
    emaFast: emaFastArr[i],
    emaSlow: emaSlowArr[i],
    emaTrend: emaTrendArr[i],
    rsi: rsiArr[i],
    macdHist: histogram[i],
    adx: adxArr[i],
    atr: atrArr[i],
    volumeSma: volumeSmaArr[i],
  }));
}

function confluenceAt(data, i) {
  const last = data[i];
  const prev = data[i - 1];
  const pattern = detectPatternAt(data, i);
  const bull = [];
  const bear = [];

  if (last.emaFast > last.emaSlow && prev.emaFast <= prev.emaSlow) bull.push("croisement_ema_haussier");
  if (last.emaFast < last.emaSlow && prev.emaFast >= prev.emaSlow) bear.push("croisement_ema_baissier");
  if (last.emaFast > last.emaSlow && last.emaSlow > last.emaTrend) bull.push("structure_ema_haussiere");
  if (last.emaFast < last.emaSlow && last.emaSlow < last.emaTrend) bear.push("structure_ema_baissiere");

  if (BULLISH_PATTERNS.has(pattern)) bull.push(`pattern_${pattern}`);
  if (BEARISH_PATTERNS.has(pattern)) bear.push(`pattern_${pattern}`);

  if (last.rsi > 40 && last.rsi < 70 && last.rsi > prev.rsi && prev.rsi < 45) bull.push("rsi_sortie_survente");
  if (last.rsi > 30 && last.rsi < 60 && last.rsi < prev.rsi && prev.rsi > 55) bear.push("rsi_sortie_surachat");

  if (last.macdHist > 0 && prev.macdHist <= 0) bull.push("macd_croisement_haussier");
  if (last.macdHist < 0 && prev.macdHist >= 0) bear.push("macd_croisement_baissier");

  if (last.volume > last.volumeSma * 1.2) {
    (last.close > last.open ? bull : bear).push("volume_confirme");
  }

  return { bull, bear, pattern };
}

function buildRationale(signal, bull, bear, adxVal) {
  if (signal === "ACHAT") return `Confluence haussiere (${bull.join(", ")}), ADX=${adxVal.toFixed(1)}`;
  if (signal === "VENTE") return `Confluence baissiere (${bear.join(", ")}), ADX=${adxVal.toFixed(1)}`;
  if (signal === "CALME") return `ADX=${adxVal.toFixed(1)} sous le seuil de tendance, aucune figure significative`;
  return `Signaux insuffisants ou contradictoires (haussier=${bull.length}, baissier=${bear.length}), a confirmer`;
}

function signalFromRow(symbol, data, i) {
  const last = data[i];
  const { bull, bear, pattern } = confluenceAt(data, i);
  const trending = last.adx > CONFIG.adxTrendThreshold;

  let signal;
  if (trending && bull.length >= CONFIG.minConfirmations && bull.length > bear.length) signal = "ACHAT";
  else if (trending && bear.length >= CONFIG.minConfirmations && bear.length > bull.length) signal = "VENTE";
  else if (!trending && pattern === null) signal = "CALME";
  else signal = "A_SURVEILLER";

  return {
    symbol,
    signal,
    close: last.close,
    atr: last.atr,
    adx: last.adx,
    pattern,
    confirmationsBull: bull,
    confirmationsBear: bear,
    rationale: buildRationale(signal, bull, bear, last.adx),
    stopLoss: null,
    takeProfit: null,
    positionSize: null,
  };
}

function evaluate(symbol, candles) {
  const data = computeIndicators(candles);
  return signalFromRow(symbol, data, data.length - 1);
}

function applyRiskManagement(result, capital = CONFIG.capitalTotal) {
  if (result.signal !== "ACHAT" && result.signal !== "VENTE") return result;
  const stopDistance = CONFIG.atrStopMultiplier * result.atr;
  if (stopDistance <= 0) return result;

  if (result.signal === "ACHAT") {
    result.stopLoss = result.close - stopDistance;
    result.takeProfit = result.close + stopDistance * CONFIG.takeProfitRR;
  } else {
    result.stopLoss = result.close + stopDistance;
    result.takeProfit = result.close - stopDistance * CONFIG.takeProfitRR;
  }

  const riskAmount = capital * CONFIG.riskPerTradePct;
  result.positionSize = riskAmount / stopDistance;
  const maxNotional = capital * CONFIG.maxExposurePerAssetPct;
  if (result.positionSize * result.close > maxNotional) {
    result.positionSize = maxNotional / result.close;
  }
  return result;
}
