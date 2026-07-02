// Port de support_resistance.py
// Note v1: contrairement a la version Python (fenetres separees 12 mois /
// 5 ans via des fetchs historiques distincts), l'app mobile calcule les deux
// horizons sur la meme fenetre de 250 jours pour limiter le volume de
// donnees telecharge sur le telephone. Les niveaux "long terme" seront donc
// moins profonds que sur la version desktop.

function swingPoints(candles, window) {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const highs = [];
  const lows = [];
  for (let i = window; i < n - window; i++) {
    const slice = closes.slice(i - window, i + window + 1);
    const maxVal = Math.max(...slice);
    const minVal = Math.min(...slice);
    if (closes[i] === maxVal) highs.push({ date: candles[i].time, price: closes[i] });
    if (closes[i] === minVal) lows.push({ date: candles[i].time, price: closes[i] });
  }
  return { highs, lows };
}

function clusterPivots(points, kind, horizon, tolerancePct) {
  if (points.length === 0) return [];
  const ordered = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of ordered) {
    if (clusters.length > 0) {
      const lastCluster = clusters[clusters.length - 1];
      const mean = lastCluster.reduce((s, x) => s + x.price, 0) / lastCluster.length;
      if (Math.abs(p.price - mean) / mean <= tolerancePct) {
        lastCluster.push(p);
        continue;
      }
    }
    clusters.push([p]);
  }
  return clusters.map((c) => ({
    price: c.reduce((s, p) => s + p.price, 0) / c.length,
    kind,
    horizon,
    touches: c.length,
    lastTouch: c.reduce((max, p) => (p.date > max ? p.date : max), c[0].date),
  }));
}

function findLevels(candles, window, horizon, tolerancePct = CONFIG.srTolerancePct) {
  const { highs, lows } = swingPoints(candles, window);
  const resistances = clusterPivots(highs, "resistance", horizon, tolerancePct);
  const supports = clusterPivots(lows, "support", horizon, tolerancePct);
  return [...resistances, ...supports].sort((a, b) => a.price - b.price);
}

function analyzeSymbol(candles) {
  const currentPrice = candles[candles.length - 1].close;
  const mediumLevels = findLevels(candles, CONFIG.srMediumTermWindow, "moyen_terme");
  const longLevels = findLevels(candles, CONFIG.srLongTermWindow, "long_terme");
  const all = [...mediumLevels, ...longLevels];

  const support = all
    .filter((l) => l.kind === "support" && l.price < currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(-CONFIG.srLevelsPerSide * 2);
  const resistance = all
    .filter((l) => l.kind === "resistance" && l.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, CONFIG.srLevelsPerSide * 2);

  return { support, resistance };
}

function nearestPair(levels, currentPrice) {
  const supports = (levels && levels.support) || [];
  const resistances = (levels && levels.resistance) || [];
  const nearestSupport = supports.length
    ? supports.reduce((a, b) => (currentPrice - a.price < currentPrice - b.price ? a : b))
    : null;
  const nearestResistance = resistances.length
    ? resistances.reduce((a, b) => (a.price - currentPrice < b.price - currentPrice ? a : b))
    : null;
  return { nearestSupport, nearestResistance };
}
