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

  // Une granularite de bougies dediee par horizon plutot qu'une seule
  // fenetre journaliere tranchee en trois: plus juste (un support long
  // terme n'a pas de sens lu sur un graphique journalier) et ca evite le
  // plafond de l'API Kraken (~720 bougies journalieres max, insuffisant
  // pour 5 ans). "moyen_terme" n'a pas de champ interval/candles: il est
  // obtenu en tranchant l'historique journalier deja charge pour les
  // indicateurs, sans requete dediee.
  srHorizons: {
    court_terme: { interval: "4h", candles: 84, window: 3 }, // 2 semaines
    moyen_terme: { candles: 90, window: 5 }, // 3 mois, tranche du journalier existant
    long_terme: {
      interval: "1M",
      candles: 60, // 5 ans en mensuel (Binance/Hyperliquid)
      window: 2,
      krakenInterval: "15d", // Kraken ne supporte pas le mensuel calendaire
      krakenCandles: 121, // 5 ans en bougies de 15 jours
      krakenWindow: 4,
    },
  },

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

// Sauvegarde optionnelle sur Google Drive (dossier prive appDataFolder).
// Client ID public (pas un secret: les apps OAuth "installees/SPA" exposent
// toujours leur client_id cote client, la securite vient du domaine
// autorise configure sur ce client dans Google Cloud Console).
const GOOGLE_CLIENT_ID = "334461656685-u94romlkpcr3d76i5f1e7g5b7jhdg1sk.apps.googleusercontent.com";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
