# signalTradebtc

Système de suivi quotidien de marchés crypto : analyse technique multi-indicateurs,
alerte de retournement de tendance de fond, niveaux de support/résistance, gestion
du risque, backtesting et comparaison à un DCA mensuel classique.

**Avertissement** : outil d'aide à la décision. Ne constitue pas un conseil
financier. Aucune position ne doit être ouverte sans supervision humaine et
backtest préalable.

## Vue d'ensemble

```
CoinGecko + Binance          Binance (ccxt)          CoinGecko / alternative.me
     |                            |                          |
     v                            v                          v
universe.py              data_fetcher.py          fundamental_filter.py
(top 50 hors stables)    historical_data.py       (dominance BTC, Fear & Greed)
     |                            |                          |
     v                            v                          |
     +------------------> indicators.py + patterns.py        |
                                  |                           |
                                  v                           |
                          signal_engine.py  <------------------
                          (confluence -> ACHAT/VENTE/CALME/A_SURVEILLER)
                                  |
                                  v
                          risk_manager.py (stop-loss ATR, position sizing, exposition max)
                                  |
                                  v
                          report.py --> rapport_du_jour.md
                                  ^
                                  |
                          trend_regime.py (retournement tendance de fond)
                          support_resistance.py (niveaux a surveiller)
```

Orchestré quotidiennement par [main.py](main.py) (`python main.py`), qui écrit
`rapport_du_jour.md` (texte) et `rapport_du_jour.html` (visuel, une carte par
actif, sans dépendance externe) sur les 50 actifs de [universe.py](universe.py).

## Modules

| Fichier | Rôle |
|---|---|
| [config.py](config.py) | Tous les paramètres (watchlist fallback, capital, seuils indicateurs, gestion du risque) |
| [universe.py](universe.py) | Watchlist dynamique : top 50 cryptos par capitalisation hors stablecoins (CoinGecko), filtré aux paires XXX/USDT cotées sur Binance, cache 24h |
| [data_fetcher.py](data_fetcher.py) | Récupération OHLCV temps réel (Binance via ccxt) pour le scan du jour |
| [historical_data.py](historical_data.py) | Récupération OHLCV historique avec **cache CSV local incrémental** ([data/](data)) pour backtests |
| [indicators.py](indicators.py) | EMA, SMA, RSI, MACD, ATR, ADX (calculs vectorisés pandas, sans TA-Lib) |
| [patterns.py](patterns.py) | Détection de chandeliers (engulfing haussier/baissier, marteau, doji, étoile du matin/soir) |
| [signal_engine.py](signal_engine.py) | Moteur de confluence : combine indicateurs + patterns pour émettre ACHAT/VENTE/CALME/À_SURVEILLER |
| [risk_manager.py](risk_manager.py) | Stop-loss (ATR × multiplicateur), take-profit (ratio R:R), taille de position (% capital risqué), plafond d'exposition par actif et global |
| [supertrend.py](supertrend.py) | Suivi de tendance serré et réactif (bande ATR type Supertrend) — informatif, complémentaire au signal tactique et au retournement de fond |
| [fundamental_filter.py](fundamental_filter.py) | Contexte macro : dominance BTC (CoinGecko), Fear & Greed Index (alternative.me) |
| [trend_regime.py](trend_regime.py) | Alerte de **retournement de tendance de fond** (golden/death cross EMA50/EMA200 confirmé par l'ADX) — préservation du capital |
| [support_resistance.py](support_resistance.py) | Niveaux de support/résistance moyen terme et long terme (points pivots regroupés en zones) |
| [power_law.py](power_law.py) | Loi de puissance BTC : position du prix dans le corridor de valorisation long terme |
| [variations.py](variations.py) | Variations de prix veille / 7 jours / 30 jours |
| [formatting.py](formatting.py) | Formatage partagé des prix (précision adaptative pour les tokens à très faible valeur) |
| [signal_display.py](signal_display.py) | Logique partagée markdown/HTML pour résoudre le libellé affiché (ACHAT/VENTE/CALME/RENFORCER/ALLEGER) |
| [report.py](report.py) | Assemble tout dans le rapport markdown quotidien |
| [html_report.py](html_report.py) | Assemble tout dans un rapport HTML visuel (une carte par actif), sans dépendance externe |
| [main.py](main.py) | Orchestrateur du scan quotidien, écrit `rapport_du_jour.md` et `rapport_du_jour.html` |
| [backtester.py](backtester.py) | Moteur de backtest jour par jour (sans lookahead), simule entrées/sorties avec stop/take-profit |
| [metrics.py](metrics.py) | Calcul partagé des métriques de performance (rendement, CAGR, drawdown, Sharpe) |
| [dca_benchmark.py](dca_benchmark.py) | Simulation d'un DCA mensuel classique (benchmark) |
| [backtest_runner.py](backtest_runner.py) | CLI pour lancer le backtest de la stratégie signal sur N années |
| [compare_strategies.py](compare_strategies.py) | CLI pour comparer stratégie signal vs DCA sur une période donnée |
| [optimizer.py](optimizer.py) | Grid search sur les paramètres de `config` pour optimiser le Sharpe |
| [trend_monitor.py](trend_monitor.py) | CLI pour lister l'historique des alertes de retournement de tendance de fond |

## Watchlist (top 50 hors stablecoins)

`universe.get_watchlist(50)` récupère le top 50 par capitalisation via CoinGecko
(en excluant la catégorie "stablecoins"), mappe chaque coin sur sa paire
`XXX/USDT` si elle existe réellement sur Binance (`ccxt.load_markets()`), et
rejette les tickers non-ASCII (un ticker en caractères chinois s'était glissé
dans le mapping lors des tests — `币安人生/USDT` — signe d'une collision/anomalie
de données CoinGecko/Binance plutôt qu'une vraie crypto). Résultat mis en cache
24h dans `data/watchlist_top50.json`. En cas d'échec réseau, retombe sur le
cache existant même périmé, puis sur `config.WATCHLIST` (3 actifs) en dernier
recours. Note : des jetons adossés à l'or (XAUT, PAXG) passent le filtre
"hors stablecoin" au sens strict CoinGecko mais se comportent comme des
quasi-stablecoins (prix quasi plat) — pas exclus pour l'instant.

Tous les scripts (`main.py`, `backtest_runner.py`, `compare_strategies.py`,
`optimizer.py`, `trend_monitor.py`) utilisent cette watchlist de 50 actifs.

**Coût opérationnel** : le scan quotidien complet sur 50 actifs prend environ
7 minutes, dominées par la latence réseau (~100 appels API séquentiels), pas
par le volume de données — le cache historique ne réduit pas ce temps de façon
significative. Acceptable pour un cron quotidien; parallélisable si besoin.

## Stockage des données historiques

Cache CSV local dans [data/](data), un fichier par paire (`BTC-USDT_1d.csv`, etc.),
colonnes `timestamp,open,high,low,close,volume`. Un appel à `fetch_history()`
détecte la portion manquante (plus ancienne ou plus récente que le cache) et ne
retélécharge que celle-ci — permet d'étendre l'historique progressivement (3 ans
puis 10 ans) sans tout recharger. Limite réelle : Binance liste BTC/ETH depuis le
17/08/2017 et SOL depuis le 11/08/2020 — impossible d'avoir 10 ans pleins sur ces
actifs.

## Logique de signal (tactique, quotidienne)

Chaque bougie journalière (après une période de chauffe de `WARMUP_PERIOD` = 210
jours pour la fiabilité de l'EMA200), le moteur vote haussier/baissier à partir de
plusieurs méthodes indépendantes (croisement EMA20/50, structure EMA20>50>200,
pattern de chandelier, sortie de zone RSI extrême, croisement MACD, pic de
volume). **Aucun signal ACHAT/VENTE n'est émis sur la base d'un seul indicateur** :
il faut `MIN_CONFIRMATIONS` (2 par défaut) votes majoritaires dans le même sens
**et** un ADX > `ADX_TREND_THRESHOLD` (marché en tendance). Sinon : CALME (ADX
faible, aucun pattern) ou À_SURVEILLER (signaux insuffisants/contradictoires).

**Affinage du libellé À_SURVEILLER** ([signal_display.py](signal_display.py)) :
quand le signal tactique est À_SURVEILLER, on compare la distance au support
le plus proche et à la résistance la plus proche pour afficher un libellé plus
actionnable :
- **RENFORCER** si un support est plus proche — zone d'opportunité pour
  ajouter à une position existante.
- **ALLEGER** si une résistance est plus proche — zone de prudence, envisager
  de réduire l'exposition.

Cette logique est partagée entre le rapport markdown et le rapport HTML (une
seule source de vérité), pour éviter toute divergence entre les deux formats.

## Retournement de tendance de fond (préservation du capital)

Indicateur distinct, volontairement lent (golden/death cross EMA50/EMA200
confirmé par l'ADX), pour détecter les changements de régime majeurs plutôt que
les signaux tactiques court terme. Validé sur l'historique complet : coïncide
avec les vrais retournements macro (top BTC juin 2021, début bear market janvier
2022, reprise février 2023). **Constat au 01/07/2026** : BTC, ETH et SOL sont en
mode retournement baissier depuis novembre 2025, sans retournement haussier
confirmé depuis.

## Suivi de tendance serré (Supertrend)

Troisième couche de suivi de tendance, entre le signal tactique quotidien
(`signal_engine.py`) et le retournement de fond lent (`trend_regime.py`) :
un [Supertrend](supertrend.py) (bande `hl2 ± multiplicateur × ATR` qui
bascule haussier/baissier à la clôture) avec des paramètres resserrés
(période 10, multiplicateur 2.0, contre 10/3.0 en réglage classique) pour un
suivi plus réactif que le golden/death cross EMA50/EMA200. Sur BTC, ça donne
~8 retournements sur les 6 derniers mois — beaucoup plus fréquent que
`trend_regime.py` (1-2 par an), et volontairement plus sujet aux faux signaux
en range en échange de cette réactivité.

**Purement informatif** : affiché dans le rapport (direction, nombre de jours
dans le sens actuel, ligne du jour), n'influence pas les signaux ACHAT/VENTE
ni le stop-loss du `risk_manager` — c'est un complément de contexte, pas un
déclencheur.

## Support / résistance

Points pivots (plus haut/bas local sur fenêtre centrée) regroupés en niveaux
par proximité de prix (tolérance 2%), sur deux horizons : moyen terme (fenêtre
±10 jours, 12 derniers mois) et long terme (fenêtre ±30 jours, 5 dernières
années). Seuls les niveaux encore actifs (non cassés) par rapport au prix
courant sont remontés dans le rapport, avec nombre de touches et date du
dernier test.

**Détection basée sur les clôtures, pas les mèches high/low** : la première
version utilisait `high`/`low`, ce qui faisait remonter de faux niveaux issus
d'incidents de liquidité — ex. ATOM/USDT a affiché une mèche à 0,001 $ pendant
quelques secondes le 10/10/2025 (krach-éclair, cascade de liquidations sur
Binance) alors que la clôture ce jour-là était à 2,95 $. Un filtre anti-mèche
basé sur l'ATR de la veille avait été envisagé, mais travailler directement sur
les clôtures règle le problème à la racine, plus simplement : une mèche
isolée n'affecte jamais la clôture. Compromis accepté : on perd l'information
des extrêmes intrabougie (une mèche qui teste un niveau sans y clôturer n'est
plus comptée comme un test).

## Loi de puissance BTC (contexte macro long terme)

Indicateur contextuel distinct de la stratégie tactique : la [loi de puissance
de Bitcoin](https://en.wikipedia.org/wiki/Bitcoin) (popularisée par Giovanni
Santostasi) modélise le prix comme `Prix(t) ≈ A × t^n`, où `t` est le nombre de
jours depuis le bloc genèse (03/01/2009). Ajustée en log-log sur l'historique
complet, elle définit un corridor de valorisation (bande basse = creux de
capitulation historiques, bande haute = sommets d'euphorie) dans lequel le prix
oscille depuis l'origine de Bitcoin.

**Source de données** ([power_law.py](power_law.py)) : l'API blockchain.info
(`/charts/market-price`, gratuite, sans clé), qui couvre l'historique BTC
depuis 2010 — contrairement à Binance (depuis 08/2017 seulement) ou CoinGecko,
dont l'endpoint gratuit limite désormais l'historique à 365 jours sans clé API
(changement de politique découvert en cours de développement). Cache local 24h
dans `data/btc_full_history.csv`.

**Validation** : l'exposant `n` ajusté sur nos données (~5,6) tombe dans la
fourchette généralement citée (5,5-6), ce qui confirme la pertinence d'utiliser
l'historique complet plutôt que les seules données Binance (un ajustement sur
2017+ uniquement aurait donné un exposant beaucoup moins fiable, faute de
dynamique de prix sur plusieurs ordres de grandeur).

**Limites** : c'est un ajustement statistique a posteriori sur une seule série
historique (~16 ans, 3-4 cycles complets) — aucune garantie que le modèle
continue de tenir. C'est un indicateur de **contexte**, pas un signal de
trading : il ne déclenche aucune position et n'est calculé que pour BTC.

## Résultats de backtest (10 ans, ou historique dispo si < 10 ans)

Paramètres par défaut, capital initial 10 000 :

| Actif | Rendement signal | Sharpe signal | Drawdown max signal |
|---|---|---|---|
| BTC/USDT | +12.8% | 0.23 | -12.4% |
| ETH/USDT | -12.6% | -0.19 | -28.8% |
| SOL/USDT | +29.8% | 0.74 | -11.7% |

**Comparaison signal vs DCA mensuel** (mêmes fenêtres) :
- **Marché haussier séculaire (2018-2026)** : le DCA écrase largement la
  stratégie signal en rendement brut (ex. BTC +266.8% en DCA vs +12.8% en
  signal) et même en Sharpe — normal, la stratégie signal n'est en position
  qu'une fraction du temps et sacrifie la majeure partie de la hausse pour
  limiter l'exposition.
- **Bear market 2022 (Terra/Luna, FTX)** : la stratégie signal protège
  nettement mieux le capital (BTC -2.3% vs -39.7% en DCA ; SOL +4.9% vs -77.3%
  en DCA). C'est là qu'elle justifie son existence.
- **Limite méthodologique notée** : le Sharpe du DCA calculé sur la courbe de
  valeur brute est faussé par les sauts artificiels dus aux apports mensuels
  (`metrics.py` corrige le calcul du rendement via un `base_capital` explicite,
  mais le Sharpe reste à interpréter avec prudence pour le DCA).

**Grid search (optimizer.py)** : améliore sensiblement le Sharpe in-sample (ex.
BTC 0.23 -> 0.87) mais chaque actif converge vers des paramètres différents —
signe de surapprentissage. **Non encore validé hors échantillon** (piste
d'amélioration identifiée mais pas implémentée : split train/test ou
walk-forward).

**Premiers signaux tactiques réels une fois passé de 3 à 50 actifs** (avec
seulement BTC/ETH/SOL, tous les scans n'avaient jamais produit que
CALME/À_SURVEILLER — trop peu d'actifs pour espérer une confluence) : au scan
du 01/07/2026, SKY/USDT a déclenché **ACHAT** (engulfing haussier + croisement
MACD, ADX=34) et DEXE/USDT **VENTE** (engulfing baissier + RSI sortant de
surachat, ADX=32). WLD/USDT a aussi déclenché sa propre alerte individuelle de
retournement de tendance de fond, indépendamment du groupe BTC/ETH/SOL/... en
mode baissier depuis novembre 2025.

## Limites connues

- Patterns de chandeliers = règles géométriques simplifiées, sans filtre de
  contexte de tendance préalable.
- Sentiment fondamental purement informatif, pas encore pondéré dans le score.
- Backtest mono-actif indépendant (pas de simulation de portefeuille partagé
  entre tous les actifs, juste un plafond d'exposition théorique côté
  `risk_manager`).
- Alerte de tendance de fond et niveaux support/résistance sont **informatifs**
  dans le rapport — n'influencent pas encore automatiquement la taille de
  position ou une éventuelle pause du DCA.
- Optimisation de paramètres non validée hors échantillon (risque de
  surapprentissage).
- Le mapping CoinGecko -> Binance de `universe.py` repose sur la correspondance
  de ticker (`SYMBOL/USDT`) : risque de collision si deux coins différents
  partagent le même ticker (rare dans le top 50, non géré explicitement).
- Jetons adossés à l'or (XAUT, PAXG) inclus dans la watchlist malgré un
  comportement quasi-stable — filtre "hors stablecoin" volontairement limité à
  la catégorie CoinGecko "stablecoins".
- Scan complet sur 50 actifs ~7 minutes, borné par la latence réseau
  (séquentiel, non parallélisé).
- La loi de puissance BTC est un ajustement statistique, pas un signal validé
  scientifiquement — dépend d'une source de donnée externe (blockchain.info)
  qui pourrait elle aussi changer de politique d'accès un jour (comme
  CoinGecko l'a fait pour son historique gratuit en cours de développement).

## Commandes utiles

```bash
python main.py                              # scan quotidien -> rapport_du_jour.md
python backtest_runner.py 10                 # backtest signal sur 10 ans
python compare_strategies.py 10              # signal vs DCA, 10 dernieres annees
python compare_strategies.py 2022-01-01 2022-12-31   # sur une periode precise
python optimizer.py 10                       # grid search des parametres
python trend_monitor.py 10                   # historique des alertes de tendance de fond
```
