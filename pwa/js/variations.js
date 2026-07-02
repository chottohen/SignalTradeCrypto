// Port de variations.py
function computeVariations(candles) {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  function pctChange(periods) {
    if (n <= periods) return null;
    return (closes[n - 1] / closes[n - 1 - periods] - 1) * 100;
  }
  return { d1: pctChange(1), d7: pctChange(7), d30: pctChange(30) };
}
