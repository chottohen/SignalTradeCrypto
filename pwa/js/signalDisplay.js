// Port de signal_display.py
function resolveDisplayLabel(signal, close, levels) {
  if (signal !== "A_SURVEILLER" || !levels) return { label: signal, watchLevel: null };

  const { nearestSupport, nearestResistance } = nearestPair(levels, close);
  const supportDist = nearestSupport ? close - nearestSupport.price : null;
  const resistanceDist = nearestResistance ? nearestResistance.price - close : null;

  if (supportDist !== null && (resistanceDist === null || supportDist <= resistanceDist)) {
    return { label: "RENFORCER", watchLevel: nearestSupport };
  }
  if (resistanceDist !== null) {
    return { label: "ALLEGER", watchLevel: nearestResistance };
  }
  return { label: "A_SURVEILLER", watchLevel: null };
}
