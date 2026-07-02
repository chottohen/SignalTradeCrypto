// Port de config.py : tous les parametres du systeme, cote client.
const CONFIG = {
  watchlistSize: 10,
  timeframe: "1d",
  candlesHistory: 250,

  capitalTotal: 10000.0,
  riskPerTradePct: 0.01,
  maxExposurePerAssetPct: 0.20,

  emaFast: 20,
  emaSlow: 50,
  emaTrend: 200,
  warmupPeriod: 210, // emaTrend + 10

  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,

  adxPeriod: 14,
  adxTrendThreshold: 20,

  atrPeriod: 14,
  atrStopMultiplier: 1.5,
  takeProfitRR: 2.0,

  minConfirmations: 2,

  srTolerancePct: 0.02,
  srLevelsPerSide: 2,
  srMediumTermWindow: 5,
  srLongTermWindow: 15,

  supertrendPeriod: 10,
  supertrendMultiplier: 2.0,
};

// Loi de puissance BTC: parametres pre-calcules hors-ligne (power_law.py),
// car blockchain.info (source de l'historique complet) n'autorise pas les
// appels CORS depuis un navigateur. Seul le prix BTC en direct (Binance,
// CORS ouvert) est necessaire pour situer le prix dans le corridor.
const POWER_LAW_PARAMS = {
  a: 5.2228837811119105e-17,
  n: 5.624094005195296,
  residualMin: -1.662418269092318,
  residualMax: 2.785386456005281,
  genesisDate: Date.UTC(2009, 0, 3),
};
