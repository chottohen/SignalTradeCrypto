// Port de power_law.py — parametres pre-calcules, voir config.js
function corridorPosition(currentBtcPrice) {
  const p = POWER_LAW_PARAMS;
  const daysSinceGenesis = (Date.now() - p.genesisDate) / (1000 * 60 * 60 * 24);
  const centralPrice = p.a * Math.pow(daysSinceGenesis, p.n);
  const lowerBand = centralPrice * Math.exp(p.residualMin);
  const upperBand = centralPrice * Math.exp(p.residualMax);
  let positionPct =
    ((Math.log(currentBtcPrice) - Math.log(lowerBand)) / (Math.log(upperBand) - Math.log(lowerBand))) * 100;
  positionPct = Math.max(0, Math.min(100, positionPct));

  let label;
  if (positionPct < 20) label = "zone de forte sous-valorisation";
  else if (positionPct < 45) label = "zone basse";
  else if (positionPct < 65) label = "corridor median";
  else if (positionPct < 85) label = "zone haute";
  else label = "zone de forte survalorisation";

  return { currentPrice: currentBtcPrice, centralPrice, lowerBand, upperBand, positionPct, label };
}
