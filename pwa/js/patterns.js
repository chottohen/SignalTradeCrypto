// Port de patterns.py
const BULLISH_PATTERNS = new Set(["bullish_engulfing", "morning_star", "hammer"]);
const BEARISH_PATTERNS = new Set(["bearish_engulfing", "evening_star"]);

function body(c) {
  return Math.abs(c.close - c.open);
}
function candleRange(c) {
  return c.high - c.low;
}
function isBullish(c) {
  return c.close > c.open;
}

function isDoji(c, threshold = 0.1) {
  const r = candleRange(c);
  return r > 0 && body(c) / r < threshold;
}

function isHammer(c, wickRatio = 2.0) {
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const b = body(c);
  return b > 0 && lowerWick > wickRatio * b && upperWick < b;
}

function isBullishEngulfing(prev, curr) {
  return !isBullish(prev) && isBullish(curr) && curr.open <= prev.close && curr.close >= prev.open;
}

function isBearishEngulfing(prev, curr) {
  return isBullish(prev) && !isBullish(curr) && curr.open >= prev.close && curr.close <= prev.open;
}

function isMorningStar(c1, c2, c3) {
  return !isBullish(c1) && body(c2) < body(c1) * 0.5 && isBullish(c3) && c3.close > (c1.open + c1.close) / 2;
}

function isEveningStar(c1, c2, c3) {
  return isBullish(c1) && body(c2) < body(c1) * 0.5 && !isBullish(c3) && c3.close < (c1.open + c1.close) / 2;
}

function detectPatternAt(candles, i) {
  if (i < 2) return null;
  const c1 = candles[i - 2];
  const c2 = candles[i - 1];
  const c3 = candles[i];
  if (isBullishEngulfing(c2, c3)) return "bullish_engulfing";
  if (isBearishEngulfing(c2, c3)) return "bearish_engulfing";
  if (isMorningStar(c1, c2, c3)) return "morning_star";
  if (isEveningStar(c1, c2, c3)) return "evening_star";
  if (isHammer(c3)) return "hammer";
  if (isDoji(c3)) return "doji";
  return null;
}
