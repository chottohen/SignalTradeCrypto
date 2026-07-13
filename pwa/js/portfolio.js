// Portefeuille virtuel: cash + positions simulees, persistees en
// localStorage. Les prix utilises sont les memes que le reste de
// l'application (dernier close journalier), pas un cours temps reel.

const PORTFOLIO_KEY = "signaltrade_portfolio_v1";
const STARTING_CASH_USD = 10000;

function loadPortfolio() {
  const raw = localStorage.getItem(PORTFOLIO_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      // cache corrompu, on repart d'un portefeuille neuf
    }
  }
  return { cashUsd: STARTING_CASH_USD, holdings: {}, transactions: [] };
}

let portfolio = loadPortfolio();

function savePortfolio() {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(portfolio));
}

// Cout d'acquisition suivi en moyenne ponderee (pas de FIFO/LIFO): a chaque
// vente partielle, on retire du cout de base la meme proportion que la part
// vendue de la position, ce qui preserve le cout moyen par unite restante.
function executeTrade(symbol, side, usdAmount, cryptoAmount, price, stopLoss) {
  if (side === "BUY") {
    portfolio.cashUsd -= usdAmount;
    const holding = portfolio.holdings[symbol] || { quantity: 0, costBasisUsd: 0 };
    holding.quantity += cryptoAmount;
    holding.costBasisUsd += usdAmount;
    portfolio.holdings[symbol] = holding;
  } else {
    portfolio.cashUsd += usdAmount;
    const holding = portfolio.holdings[symbol];
    const soldShare = cryptoAmount / holding.quantity;
    holding.quantity -= cryptoAmount;
    holding.costBasisUsd -= holding.costBasisUsd * soldShare;
    if (holding.quantity <= 1e-9) {
      delete portfolio.holdings[symbol];
    }
  }
  portfolio.transactions.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    symbol,
    side,
    usdAmount,
    cryptoAmount,
    price,
    stopLoss: side === "BUY" ? stopLoss : null,
  });
  savePortfolio();
}

// Statut du stop-loss indicatif d'un achat par rapport au cours actuel:
// "red" si le cours l'a casse, "orange" si on en est a moins de 5%, "green"
// sinon. null si aucun stop-loss n'a ete renseigne pour cette ligne.
function stopLossStatus(currentPrice, stopLoss) {
  if (stopLoss == null || !(stopLoss > 0)) return null;
  if (currentPrice <= stopLoss) return "red";
  const distancePct = ((currentPrice - stopLoss) / currentPrice) * 100;
  return distancePct < 5 ? "orange" : "green";
}

// Notification navigateur locale (pas de push, pas de serveur): declenchee
// uniquement quand la severite d'une ligne d'achat empire (vert -> orange
// -> rouge) par rapport a la derniere notification envoyee pour cette
// transaction, pour ne pas spammer a chaque rafraichissement tant que la
// situation ne change pas. L'etat est persiste pour survivre aux reloads.
const NOTIFIED_ALERTS_KEY = "signaltrade_notified_alerts_v1";
const STOP_LOSS_SEVERITY = { green: 0, orange: 1, red: 2 };

function loadNotifiedAlerts() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_ALERTS_KEY)) || {};
  } catch (e) {
    return {};
  }
}
let notifiedAlerts = loadNotifiedAlerts();

function maybeNotify(tx, symbol, status) {
  const severity = STOP_LOSS_SEVERITY[status] ?? -1;
  const prevSeverity = notifiedAlerts[tx.id] ?? -1;

  if (status !== "green" && severity > prevSeverity && "Notification" in window && Notification.permission === "granted") {
    const title = status === "red" ? `Stop-loss atteint : ${symbol}` : `Stop-loss proche : ${symbol}`;
    const body =
      status === "red"
        ? `Le cours de ${symbol} est passé sous votre stop-loss (${formatPrice(tx.stopLoss)} $).`
        : `Le cours de ${symbol} approche de votre stop-loss (${formatPrice(tx.stopLoss)} $, moins de 5% d'écart).`;
    new Notification(title, { body, tag: tx.id });
  }

  notifiedAlerts[tx.id] = severity;
  localStorage.setItem(NOTIFIED_ALERTS_KEY, JSON.stringify(notifiedAlerts));
}

function computeStopLossAlerts(priced) {
  let redCount = 0;
  let orangeCount = 0;
  priced.forEach((p) => {
    portfolio.transactions
      .filter((t) => t.symbol === p.symbol && t.side === "BUY" && t.stopLoss != null)
      .forEach((t) => {
        const status = stopLossStatus(p.price, t.stopLoss);
        if (status === "red") redCount++;
        else if (status === "orange") orangeCount++;
        maybeNotify(t, p.symbol, status);
      });
  });
  return { redCount, orangeCount };
}

function updateTabBadge(redCount, orangeCount) {
  const badge = document.getElementById("portfolio-tab-badge");
  if (redCount > 0) {
    badge.className = "tab-badge red";
    badge.style.display = "inline-block";
  } else if (orangeCount > 0) {
    badge.className = "tab-badge orange";
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

// Snapshot des derniers prix recuperes par renderPortfolioPage() (ou par le
// controle en arriere-plan checkPortfolioAlertsInBackground()), reutilise
// pour rafraichir l'alerte instantanement apres l'edition d'un stop-loss
// dans l'historique, sans re-telecharger les cours.
let lastPricedHoldings = [];

function renderPortfolioAlert() {
  const container = document.getElementById("portfolio-alert");
  container.innerHTML = "";
  const { redCount, orangeCount } = computeStopLossAlerts(lastPricedHoldings);
  updateTabBadge(redCount, orangeCount);
  if (redCount === 0 && orangeCount === 0) return;

  const parts = [];
  if (redCount > 0) parts.push(`${redCount} stop-loss atteint${redCount > 1 ? "s" : ""}`);
  if (orangeCount > 0) parts.push(`${orangeCount} proche${orangeCount > 1 ? "s" : ""} du niveau actuel`);
  const bg = redCount > 0 ? "#FCEBEB" : "#FAEEDA";
  const color = redCount > 0 ? "#501313" : "#412402";
  container.appendChild(
    el("div", { class: "alert-box", style: `background:${bg};color:${color};`, textContent: `⚠ ${parts.join(" · ")}` })
  );
}

// Verifie les stop-loss sans se soucier de la page active, pour que le
// badge sur l'onglet Portefeuille (et les notifications) fonctionnent meme
// si l'utilisateur reste sur l'onglet Marche pendant toute la session.
async function checkPortfolioAlertsInBackground() {
  const symbols = Object.keys(portfolio.holdings);
  if (symbols.length === 0) {
    updateTabBadge(0, 0);
    return;
  }
  try {
    const universe = await getSearchUniverse();
    const bySymbol = new Map(universe.map((e) => [e.symbol, e]));
    const priced = [];
    for (const symbol of symbols) {
      const entry = bySymbol.get(symbol);
      if (!entry) continue;
      try {
        const candles = await fetchCandles(entry);
        priced.push({ symbol, price: candles[candles.length - 1].close, holding: portfolio.holdings[symbol] });
      } catch (e) {
        console.error(symbol, e);
      }
    }
    lastPricedHoldings = priced;
    renderPortfolioAlert();
  } catch (e) {
    console.error("checkPortfolioAlertsInBackground", e);
  }
}

function updateNotifStatusUi() {
  const btn = document.getElementById("notif-enable-btn");
  const status = document.getElementById("notif-status");
  if (!("Notification" in window)) {
    btn.style.display = "none";
    status.textContent = "Notifications non prises en charge par ce navigateur.";
    return;
  }
  if (Notification.permission === "granted") {
    btn.style.display = "none";
    status.textContent = "Alertes stop-loss activées.";
  } else if (Notification.permission === "denied") {
    btn.style.display = "none";
    status.textContent = "Notifications bloquées (à réactiver dans les réglages du navigateur).";
  } else {
    btn.style.display = "inline-block";
    status.textContent = "";
  }
}

function holdingRowEl(priced, totalValue) {
  const { symbol, price, holding, levels } = priced;
  const valueUsd = price * holding.quantity;
  const pnlUsd = valueUsd - holding.costBasisUsd;
  const pnlPct = holding.costBasisUsd > 0 ? (pnlUsd / holding.costBasisUsd) * 100 : 0;
  const sharePct = totalValue > 0 ? (valueUsd / totalValue) * 100 : 0;
  const pnlColor = pnlUsd >= 0 ? GREEN : RED;
  const pnlSign = pnlUsd >= 0 ? "+" : "";

  const row = el("div", { class: "holding-row" }, [
    el("div", {}, [
      el("p", { class: "holding-symbol", textContent: symbol }),
      el("p", { class: "holding-amounts", textContent: `${formatPrice(holding.quantity)} ${symbol} · ${formatPrice(valueUsd)} $` }),
    ]),
    el("div", { class: "holding-stats" }, [
      el("p", { class: "holding-pnl", style: `color:${pnlColor};`, textContent: `${pnlSign}${formatPrice(pnlUsd)} $ (${pnlSign}${pnlPct.toFixed(1)}%)` }),
      el("p", { class: "holding-share", textContent: `${sharePct.toFixed(1)}% du portefeuille` }),
    ]),
  ]);

  const children = [row];

  if (levels) {
    const { nearestSupport, nearestResistance } = nearestPair(levels, price);
    if (nearestSupport || nearestResistance) {
      children.push(
        el("div", { class: "holding-levels" }, [
          levelBlock("Résistance (long terme)", nearestResistance, price, null, false),
          levelBlock("Support (long terme)", nearestSupport, price, null, true),
        ])
      );
    }
  }

  const history = el("div", { class: "holding-history", style: "display:none;" });
  renderHistoryFor(symbol, history, price);
  children.push(history);

  row.addEventListener("click", () => {
    const visible = history.style.display !== "none";
    history.style.display = visible ? "none" : "block";
  });

  return el("div", { class: "holding-wrapper" }, children);
}

const STOP_LOSS_BADGE_LABEL = { red: "Stop atteint", orange: "Stop proche", green: "Stop loin" };

function renderHistoryFor(symbol, container, currentPrice) {
  container.innerHTML = "";
  const txs = portfolio.transactions.filter((t) => t.symbol === symbol).slice().reverse();
  if (txs.length === 0) {
    container.appendChild(el("p", { class: "history-empty", textContent: "Aucune transaction." }));
    return;
  }
  txs.forEach((t) => {
    const sideLabel = t.side === "BUY" ? "Achat" : "Vente";
    const sideColor = t.side === "BUY" ? GREEN : RED;
    const status = t.side === "BUY" ? stopLossStatus(currentPrice, t.stopLoss) : null;

    const children = [
      el("p", { class: "history-side", style: `color:${sideColor};`, textContent: sideLabel }),
      el("p", {
        class: "history-detail",
        textContent: `${formatPrice(t.cryptoAmount)} ${symbol} · ${formatPrice(t.usdAmount)} $ · ${formatPrice(t.price)} $/u`,
      }),
      el("p", { class: "history-date", textContent: new Date(t.timestamp).toLocaleString("fr-FR") }),
    ];

    if (t.side === "BUY") {
      const stopInput = el("input", {
        type: "number",
        class: "history-stoploss-input",
        value: t.stopLoss != null ? t.stopLoss : "",
        inputmode: "decimal",
        step: "any",
      });
      stopInput.addEventListener("click", (e) => e.stopPropagation());
      stopInput.addEventListener("change", (e) => {
        const val = parseFloat(e.target.value);
        t.stopLoss = isNaN(val) ? null : val;
        savePortfolio();
        renderHistoryFor(symbol, container, currentPrice);
        renderPortfolioAlert();
      });

      const stopRow = [el("span", { textContent: "Stop-loss :" }), stopInput];
      if (status) {
        stopRow.push(el("span", { class: `history-stoploss-badge stop-${status}`, textContent: STOP_LOSS_BADGE_LABEL[status] }));
      }
      children.push(el("div", { class: "history-stoploss" }, stopRow));
    }

    container.appendChild(el("div", { class: status ? `history-item stop-${status}` : "history-item" }, children));
  });
}

async function renderPortfolioPage() {
  const container = document.getElementById("portfolio-holdings");
  const symbols = Object.keys(portfolio.holdings);

  document.getElementById("portfolio-cash").textContent = `Cash disponible : ${formatPrice(portfolio.cashUsd)} $`;

  if (symbols.length === 0) {
    document.getElementById("portfolio-total-value").textContent = `${formatPrice(portfolio.cashUsd)} $`;
    document.getElementById("portfolio-total-pnl").textContent = "Aucune position ouverte";
    document.getElementById("portfolio-total-pnl").style.color = "";
    lastPricedHoldings = [];
    document.getElementById("portfolio-alert").innerHTML = "";
    container.innerHTML = "";
    container.appendChild(
      el("p", { class: "portfolio-empty", textContent: "Aucune crypto détenue. Utilisez le bouton Achat pour commencer." })
    );
    return;
  }

  container.innerHTML = "";
  container.appendChild(el("p", { class: "portfolio-empty", textContent: "Chargement des cours…" }));

  const universe = await getSearchUniverse();
  const bySymbol = new Map(universe.map((e) => [e.symbol, e]));

  const priced = [];
  for (const symbol of symbols) {
    const entry = bySymbol.get(symbol);
    if (!entry) continue; // plus de source de prix disponible pour cet actif
    try {
      const candles = await fetchCandles(entry);
      const price = candles[candles.length - 1].close;
      const horizonData = await buildHorizonData(entry, candles, HORIZON_SETS.long);
      const levels = analyzeSymbol(price, horizonData);
      priced.push({ symbol, price, holding: portfolio.holdings[symbol], levels });
    } catch (e) {
      console.error(symbol, e);
    }
  }

  const totalHoldingsValue = priced.reduce((sum, p) => sum + p.price * p.holding.quantity, 0);
  const totalCostBasis = priced.reduce((sum, p) => sum + p.holding.costBasisUsd, 0);
  const totalPnlUsd = totalHoldingsValue - totalCostBasis;
  const totalPnlPct = totalCostBasis > 0 ? (totalPnlUsd / totalCostBasis) * 100 : 0;
  const totalValue = portfolio.cashUsd + totalHoldingsValue;
  const totalPnlSign = totalPnlUsd >= 0 ? "+" : "";

  document.getElementById("portfolio-total-value").textContent = `${formatPrice(totalValue)} $`;
  const pnlEl = document.getElementById("portfolio-total-pnl");
  pnlEl.textContent = `${totalPnlSign}${formatPrice(totalPnlUsd)} $ (${totalPnlSign}${totalPnlPct.toFixed(1)}%) latent`;
  pnlEl.style.color = totalPnlUsd >= 0 ? GREEN : RED;

  lastPricedHoldings = priced;
  renderPortfolioAlert();

  priced.sort((a, b) => b.price * b.holding.quantity - a.price * a.holding.quantity);
  container.innerHTML = "";
  priced.forEach((p) => container.appendChild(holdingRowEl(p, totalValue)));
}

// --- Formulaire d'achat/vente ---

let tradeState = { side: null, entry: null, price: null, heldQuantity: 0 };

function openTradeModal(side) {
  tradeState = { side, entry: null, price: null, heldQuantity: 0 };
  document.getElementById("trade-modal-title").textContent = side === "BUY" ? "Achat" : "Vente";
  document.getElementById("trade-symbol-input").value = "";
  document.getElementById("trade-usd-input").value = "";
  document.getElementById("trade-crypto-input").value = "";
  document.getElementById("trade-stoploss-input").value = "";
  document.getElementById("trade-stoploss-field").style.display = side === "BUY" ? "block" : "none";
  document.getElementById("trade-percent-field").style.display = side === "SELL" ? "block" : "none";
  document.getElementById("trade-percent-input").value = 0;
  document.getElementById("trade-percent-value").textContent = "0";
  document.getElementById("trade-selected-info").textContent = "";
  document.getElementById("trade-levels-info").innerHTML = "";
  document.getElementById("trade-error").style.display = "none";
  hideTradeSuggestions();
  document.getElementById("trade-modal").style.display = "flex";
}

function closeTradeModal() {
  document.getElementById("trade-modal").style.display = "none";
}

function hideTradeSuggestions() {
  document.getElementById("trade-symbol-suggestions").style.display = "none";
}

async function showTradeSuggestions(query) {
  const box = document.getElementById("trade-symbol-suggestions");
  box.innerHTML = "";

  let matches;
  if (tradeState.side === "SELL") {
    matches = Object.keys(portfolio.holdings).filter((s) => s.includes(query));
  } else {
    const universe = await getSearchUniverse();
    matches = universe.map((e) => e.symbol).filter((s) => s.includes(query));
  }

  if (matches.length === 0) {
    box.appendChild(
      el("div", {
        class: "suggestion-empty",
        textContent: tradeState.side === "SELL" ? "Aucune position correspondante." : "Aucun résultat dans le top 500.",
      })
    );
    box.style.display = "block";
    return;
  }
  matches.slice(0, 8).forEach((symbol) => {
    const item = el("div", { class: "suggestion-item", textContent: symbol });
    item.addEventListener("click", () => selectTradeSymbol(symbol));
    box.appendChild(item);
  });
  box.style.display = "block";
}

async function selectTradeSymbol(symbol) {
  document.getElementById("trade-symbol-input").value = symbol;
  hideTradeSuggestions();
  document.getElementById("trade-error").style.display = "none";
  document.getElementById("trade-selected-info").textContent = "Chargement du cours…";
  tradeState.entry = null;
  tradeState.price = null;

  const universe = await getSearchUniverse();
  const entry = universe.find((e) => e.symbol === symbol);
  if (!entry) {
    document.getElementById("trade-selected-info").textContent = "Cours indisponible pour cet actif.";
    return;
  }
  const levelsInfoEl = document.getElementById("trade-levels-info");
  levelsInfoEl.innerHTML = "";
  try {
    const candles = await fetchCandles(entry);
    tradeState.entry = entry;
    tradeState.price = candles[candles.length - 1].close;
    document.getElementById("trade-selected-info").textContent = `${symbol} — cours actuel : ${formatPrice(tradeState.price)} $`;

    // Les 3 horizons (court/moyen/long terme) sont calcules avant toute
    // decision d'achat ou de vente, pour situer le cours par rapport aux
    // niveaux techniques dans les deux cas.
    const horizonData = await buildHorizonData(entry, candles, HORIZON_SETS.all);
    const levels = analyzeSymbol(tradeState.price, horizonData);
    const { nearestSupport, nearestResistance } = nearestPair(levels, tradeState.price);

    if (nearestSupport || nearestResistance) {
      levelsInfoEl.appendChild(
        el("div", {}, [
          levelBlock("Résistance", nearestResistance, tradeState.price, null, false),
          levelBlock("Support", nearestSupport, tradeState.price, null, true),
        ])
      );
    }

    if (tradeState.side === "BUY") {
      document.getElementById("trade-stoploss-input").value = nearestSupport ? nearestSupport.price : "";
    } else {
      const held = portfolio.holdings[symbol];
      tradeState.heldQuantity = held ? held.quantity : 0;
      document.getElementById("trade-percent-input").value = 0;
      document.getElementById("trade-percent-value").textContent = "0";
    }
  } catch (e) {
    document.getElementById("trade-selected-info").textContent = `Erreur: ${e.message}`;
  }
}

function confirmTrade() {
  const errorEl = document.getElementById("trade-error");
  errorEl.style.display = "none";

  if (!tradeState.entry || !tradeState.price) {
    errorEl.textContent = "Sélectionnez d'abord une crypto.";
    errorEl.style.display = "block";
    return;
  }

  const usdAmount = parseFloat(document.getElementById("trade-usd-input").value);
  const cryptoAmount = parseFloat(document.getElementById("trade-crypto-input").value);
  if (!(usdAmount > 0) || !(cryptoAmount > 0)) {
    errorEl.textContent = "Entrez un montant valide.";
    errorEl.style.display = "block";
    return;
  }

  // Tolerance sur les comparaisons: le curseur/champ quantite affiche des
  // valeurs arrondies (toFixed), qui peuvent depasser de quelques unites
  // au 9e chiffre apres la virgule la valeur exacte stockee (ex: curseur a
  // 100% d'une position) sans que ce soit un vrai depassement.
  const EPSILON = 1e-8;
  const symbol = tradeState.entry.symbol;
  let finalCryptoAmount = cryptoAmount;

  if (tradeState.side === "BUY") {
    if (usdAmount > portfolio.cashUsd + EPSILON) {
      errorEl.textContent = `Montant supérieur au cash disponible (${formatPrice(portfolio.cashUsd)} $).`;
      errorEl.style.display = "block";
      return;
    }
  } else {
    const held = portfolio.holdings[symbol];
    if (!held || cryptoAmount > held.quantity + EPSILON) {
      errorEl.textContent = `Quantité supérieure à la position détenue (${held ? formatPrice(held.quantity) : 0} ${symbol}).`;
      errorEl.style.display = "block";
      return;
    }
    // Ne jamais vendre plus que ce qui est reellement detenu (curseur a
    // 100% doit clore la position exactement, sans reliquat de poussiere).
    finalCryptoAmount = Math.min(cryptoAmount, held.quantity);
  }

  let stopLoss = null;
  if (tradeState.side === "BUY") {
    const stopLossVal = parseFloat(document.getElementById("trade-stoploss-input").value);
    stopLoss = isNaN(stopLossVal) ? null : stopLossVal;
  }

  executeTrade(symbol, tradeState.side, usdAmount, finalCryptoAmount, tradeState.price, stopLoss);
  closeTradeModal();
  renderPortfolioPage();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-buy").addEventListener("click", () => openTradeModal("BUY"));
  document.getElementById("btn-sell").addEventListener("click", () => openTradeModal("SELL"));
  document.getElementById("trade-cancel-btn").addEventListener("click", closeTradeModal);
  document.getElementById("trade-confirm-btn").addEventListener("click", confirmTrade);

  updateNotifStatusUi();
  document.getElementById("notif-enable-btn").addEventListener("click", async () => {
    await Notification.requestPermission();
    updateNotifStatusUi();
  });

  const symbolInput = document.getElementById("trade-symbol-input");
  symbolInput.addEventListener("input", (e) => {
    const query = e.target.value.trim().toUpperCase();
    tradeState.entry = null;
    tradeState.price = null;
    document.getElementById("trade-selected-info").textContent = "";
    if (!query) {
      hideTradeSuggestions();
      return;
    }
    showTradeSuggestions(query);
  });

  function syncPercentFromQuantity(qty) {
    if (tradeState.side !== "SELL" || !tradeState.heldQuantity) return;
    const pct = isNaN(qty) ? 0 : Math.min(100, Math.max(0, (qty / tradeState.heldQuantity) * 100));
    document.getElementById("trade-percent-input").value = pct;
    document.getElementById("trade-percent-value").textContent = pct.toFixed(0);
  }

  document.getElementById("trade-usd-input").addEventListener("input", (e) => {
    if (!tradeState.price) return;
    const usd = parseFloat(e.target.value);
    if (!isNaN(usd)) {
      const qty = usd / tradeState.price;
      document.getElementById("trade-crypto-input").value = qty.toFixed(8);
      syncPercentFromQuantity(qty);
    }
  });
  document.getElementById("trade-crypto-input").addEventListener("input", (e) => {
    if (!tradeState.price) return;
    const qty = parseFloat(e.target.value);
    if (!isNaN(qty)) document.getElementById("trade-usd-input").value = (qty * tradeState.price).toFixed(2);
    syncPercentFromQuantity(qty);
  });
  document.getElementById("trade-percent-input").addEventListener("input", (e) => {
    if (tradeState.side !== "SELL" || !tradeState.heldQuantity || !tradeState.price) return;
    const pct = parseFloat(e.target.value);
    document.getElementById("trade-percent-value").textContent = pct.toFixed(0);
    const qty = tradeState.heldQuantity * (pct / 100);
    document.getElementById("trade-crypto-input").value = qty.toFixed(8);
    document.getElementById("trade-usd-input").value = (qty * tradeState.price).toFixed(2);
  });

  document.getElementById("trade-modal").addEventListener("click", (e) => {
    if (e.target.id === "trade-modal") closeTradeModal();
  });
});
