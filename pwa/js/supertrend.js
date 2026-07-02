// Port de supertrend.py
function computeSupertrend(candles, period = CONFIG.supertrendPeriod, multiplier = CONFIG.supertrendMultiplier) {
  const atrArr = atr(candles, period);
  const n = candles.length;
  const basicUpper = candles.map((c, i) => (c.high + c.low) / 2 + multiplier * atrArr[i]);
  const basicLower = candles.map((c, i) => (c.high + c.low) / 2 - multiplier * atrArr[i]);
  const finalUpper = [...basicUpper];
  const finalLower = [...basicLower];
  const bullish = new Array(n).fill(true);
  const line = new Array(n).fill(null);

  for (let i = 1; i < n; i++) {
    finalUpper[i] =
      basicUpper[i] < finalUpper[i - 1] || candles[i - 1].close > finalUpper[i - 1] ? basicUpper[i] : finalUpper[i - 1];
    finalLower[i] =
      basicLower[i] > finalLower[i - 1] || candles[i - 1].close < finalLower[i - 1] ? basicLower[i] : finalLower[i - 1];
    bullish[i] = bullish[i - 1] ? candles[i].close >= finalLower[i] : candles[i].close > finalUpper[i];
    line[i] = bullish[i] ? finalLower[i] : finalUpper[i];
  }

  return { bullish, line };
}

function supertrendStatus(candles) {
  const { bullish, line } = computeSupertrend(candles);
  const n = candles.length;
  const flippedToday = n > 1 && bullish[n - 1] !== bullish[n - 2];

  let daysInDirection = 1;
  const currentDir = bullish[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    if (bullish[i] !== currentDir) break;
    daysInDirection++;
  }

  return {
    direction: bullish[n - 1] ? "HAUSSIER" : "BAISSIER",
    line: line[n - 1],
    flippedToday,
    daysInDirection,
  };
}
