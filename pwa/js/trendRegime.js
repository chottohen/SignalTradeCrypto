// Port de trend_regime.py
function currentTrendState(data) {
  const last = data[data.length - 1];
  return last.emaSlow > last.emaTrend ? "HAUSSIERE" : "BAISSIERE";
}

function detectTrendReversalAt(data, i) {
  if (i < 1) return null;
  const last = data[i];
  const prev = data[i - 1];

  const deathCross = last.emaSlow < last.emaTrend && prev.emaSlow >= prev.emaTrend;
  const goldenCross = last.emaSlow > last.emaTrend && prev.emaSlow <= prev.emaTrend;
  const trending = last.adx > CONFIG.adxTrendThreshold;

  if (deathCross && last.close < last.emaTrend && trending) {
    return {
      type: "RETOURNEMENT_BAISSIER",
      rationale: `Death cross: EMA50 sous EMA200, prix sous EMA200, ADX=${last.adx.toFixed(1)} > ${CONFIG.adxTrendThreshold} -> tendance de fond haussiere terminee, mode preservation du capital.`,
    };
  }
  if (goldenCross && last.close > last.emaTrend && trending) {
    return {
      type: "RETOURNEMENT_HAUSSIER",
      rationale: `Golden cross: EMA50 au-dessus EMA200, prix au-dessus EMA200, ADX=${last.adx.toFixed(1)} > ${CONFIG.adxTrendThreshold} -> tendance baissiere de fond terminee, reprise d'exposition envisageable.`,
    };
  }
  return null;
}
