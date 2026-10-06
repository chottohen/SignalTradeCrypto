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
function executeTrade(symbol, side, usdAmount, cryptoAmount, price, stopLoss, takeProfit) {
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
    takeProfit: side === "BUY" ? takeProfit ?? null : null,
  });
  savePortfolio();
}

// Notes libres par position (raison d'achat, strategie de suivi...), rangees
// dans le portefeuille pour etre sauvegardees avec lui sur Drive. Creees a la
// demande: les anciennes sauvegardes n'ont pas ce champ.
function getNote(symbol) {
  return (portfolio.notes && portfolio.notes[symbol]) || "";
}

function setNote(symbol, text) {
  if (!portfolio.notes) portfolio.notes = {};
  const trimmed = text.trim();
  if (trimmed) portfolio.notes[symbol] = trimmed;
  else delete portfolio.notes[symbol];
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

// Meme schema pour le take-profit: "hit" si le cours l'a atteint ou depasse,
// "near" a moins de 5% en dessous, "far" sinon. null si non renseigne.
function takeProfitStatus(currentPrice, takeProfit) {
  if (takeProfit == null || !(takeProfit > 0)) return null;
  if (currentPrice >= takeProfit) return "hit";
  const distancePct = ((takeProfit - currentPrice) / currentPrice) * 100;
  return distancePct < 5 ? "near" : "far";
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

// Severite commune SL/TP: 0 = loin, 1 = proche, 2 = atteint. On ne notifie
// que lorsqu'elle monte (>= 1 et superieure a la derniere notifiee); la
// cle distingue le stop-loss (id) du take-profit (id + ":tp") d'une meme ligne.
function notifyOnWorsening(key, severity, title, body) {
  const prevSeverity = notifiedAlerts[key] ?? -1;
  if (severity >= 1 && severity > prevSeverity) {
    showLocalNotification(title, { body, tag: key });
  }
  notifiedAlerts[key] = severity;
  localStorage.setItem(NOTIFIED_ALERTS_KEY, JSON.stringify(notifiedAlerts));
}

function maybeNotify(tx, symbol, status) {
  const severity = STOP_LOSS_SEVERITY[status] ?? -1;
  const title = status === "red" ? `Stop-loss atteint : ${symbol}` : `Stop-loss proche : ${symbol}`;
  const body =
    status === "red"
      ? `Le cours de ${symbol} est passé sous votre stop-loss (${formatPrice(tx.stopLoss)} $).`
      : `Le cours de ${symbol} approche de votre stop-loss (${formatPrice(tx.stopLoss)} $, moins de 5% d'écart).`;
  notifyOnWorsening(tx.id, severity, title, body);
}

const TAKE_PROFIT_SEVERITY = { far: 0, near: 1, hit: 2 };

function maybeNotifyTakeProfit(tx, symbol, status) {
  const severity = TAKE_PROFIT_SEVERITY[status] ?? -1;
  const title = status === "hit" ? `Take-profit atteint : ${symbol}` : `Take-profit proche : ${symbol}`;
  const body =
    status === "hit"
      ? `Le cours de ${symbol} a atteint votre take-profit (${formatPrice(tx.takeProfit)} $).`
      : `Le cours de ${symbol} approche de votre take-profit (${formatPrice(tx.takeProfit)} $, moins de 5% d'écart).`;
  notifyOnWorsening(`${tx.id}:tp`, severity, title, body);
}

// Lignes d'achat a evaluer pour un symbole detenu: celles qui portent un
// stop-loss et/ou un take-profit.
function alertLinesFor(symbol) {
  return portfolio.transactions.filter(
    (t) => t.symbol === symbol && t.side === "BUY" && (t.stopLoss != null || t.takeProfit != null)
  );
}

// Compte les alertes par niveau pour un symbole, sans effet de bord.
function symbolAlertCounts(symbol, price) {
  const counts = { slHit: 0, slNear: 0, tpHit: 0, tpNear: 0 };
  alertLinesFor(symbol).forEach((t) => {
    const sl = stopLossStatus(price, t.stopLoss);
    const tp = takeProfitStatus(price, t.takeProfit);
    if (sl === "red") counts.slHit++;
    else if (sl === "orange") counts.slNear++;
    if (tp === "hit") counts.tpHit++;
    else if (tp === "near") counts.tpNear++;
  });
  return counts;
}

function computeStopLossAlerts(priced) {
  const total = { slHit: 0, slNear: 0, tpHit: 0, tpNear: 0 };
  priced.forEach((p) => {
    alertLinesFor(p.symbol).forEach((t) => {
      const sl = stopLossStatus(p.price, t.stopLoss);
      const tp = takeProfitStatus(p.price, t.takeProfit);
      if (sl) maybeNotify(t, p.symbol, sl);
      if (tp) maybeNotifyTakeProfit(t, p.symbol, tp);
    });
    const counts = symbolAlertCounts(p.symbol, p.price);
    Object.keys(total).forEach((k) => (total[k] += counts[k]));
  });
  return total;
}

function updateTabBadge(counts) {
  const badge = document.getElementById("portfolio-tab-badge");
  if (counts.slHit > 0) {
    badge.className = "tab-badge red";
  } else if (counts.tpHit > 0) {
    badge.className = "tab-badge blue";
  } else if (counts.slNear > 0 || counts.tpNear > 0) {
    badge.className = "tab-badge orange";
  } else {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "inline-block";
}

// Snapshot des derniers prix recuperes par renderPortfolioPage() (ou par le
// controle en arriere-plan checkPortfolioAlertsInBackground()), reutilise
// pour rafraichir l'alerte instantanement apres l'edition d'un stop-loss
// dans l'historique, sans re-telecharger les cours.
let lastPricedHoldings = [];

function renderPortfolioAlert() {
  const container = document.getElementById("portfolio-alert");
  container.innerHTML = "";
  const counts = computeStopLossAlerts(lastPricedHoldings);
  updateTabBadge(counts);
  const nearCount = counts.slNear + counts.tpNear;
  if (counts.slHit === 0 && counts.tpHit === 0 && nearCount === 0) return;

  const parts = [];
  if (counts.slHit > 0) parts.push(`${counts.slHit} stop-loss atteint${counts.slHit > 1 ? "s" : ""}`);
  if (counts.tpHit > 0) parts.push(`${counts.tpHit} take-profit atteint${counts.tpHit > 1 ? "s" : ""}`);
  if (nearCount > 0) parts.push(`${nearCount} proche${nearCount > 1 ? "s" : ""} d'un SL/TP`);

  let bg = "#FAEEDA";
  let color = "#412402";
  if (counts.slHit > 0) {
    bg = "#FCEBEB";
    color = "#501313";
  } else if (counts.tpHit > 0) {
    bg = "#E6F1FB";
    color = "#0C447C";
  }
  container.appendChild(el("div", { class: "alert-box", style: `background:${bg};color:${color};`, textContent: `⚠ ${parts.join(" · ")}` }));
}

// Verifie les stop-loss sans se soucier de la page active, pour que le
// badge sur l'onglet Portefeuille (et les notifications) fonctionnent meme
// si l'utilisateur reste sur l'onglet Marche pendant toute la session.
async function checkPortfolioAlertsInBackground() {
  const symbols = Object.keys(portfolio.holdings);
  if (symbols.length === 0) {
    updateTabBadge({ slHit: 0, slNear: 0, tpHit: 0, tpNear: 0 });
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
        if (candles.length > CONFIG.warmupPeriod) {
          const data = computeIndicators(candles);
          maybeNotifyCross(symbol, crossProximityStatus(data, data.length - 1));
        }
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
    status.textContent = "Alertes stop-loss, take-profit et croisement activées.";
  } else if (Notification.permission === "denied") {
    btn.style.display = "none";
    status.textContent = "Notifications bloquées (à réactiver dans les réglages du navigateur).";
  } else {
    btn.style.display = "inline-block";
    status.textContent = "";
  }
}

// Resume des alertes SL/TP d'une position, visible sans deplier l'historique.
function holdingAlertTagEl(symbol, price) {
  const c = symbolAlertCounts(symbol, price);
  const near = c.slNear + c.tpNear;
  if (!c.slHit && !c.tpHit && !near) return null;

  const parts = [];
  if (c.slHit) parts.push(`${c.slHit} stop-loss atteint${c.slHit > 1 ? "s" : ""}`);
  if (c.tpHit) parts.push(`${c.tpHit} take-profit atteint${c.tpHit > 1 ? "s" : ""}`);
  if (near) parts.push(`${near} proche${near > 1 ? "s" : ""} d'un SL/TP`);
  const color = c.slHit ? RED : c.tpHit ? "#0C447C" : AMBER;
  return el("p", { class: "holding-alert-tag", style: `color:${color};`, textContent: `⚠ ${parts.join(" · ")}` });
}

// Note libre de la position, affichee sur la carte; un clic ouvre l'edition.
function noteBlockEl(symbol) {
  const wrapper = el("div", { class: "holding-note" });

  const showText = () => {
    wrapper.innerHTML = "";
    const text = getNote(symbol);
    const display = el("p", {
      class: text ? "holding-note-text" : "holding-note-text empty",
      textContent: text || "Ajouter une note (raison d'achat, stratégie de suivi…)",
    });
    display.addEventListener("click", showEditor);
    wrapper.appendChild(display);
  };

  const showEditor = () => {
    wrapper.innerHTML = "";
    const area = el("textarea", { class: "holding-note-input", rows: 3, value: getNote(symbol), placeholder: "Raison d'achat, stratégie de suivi…" });
    const save = el("button", { class: "drive-btn primary", type: "button", textContent: "Enregistrer" });
    const cancel = el("button", { class: "drive-btn", type: "button", textContent: "Annuler" });
    save.addEventListener("click", () => {
      setNote(symbol, area.value);
      showText();
    });
    cancel.addEventListener("click", showText);
    wrapper.appendChild(area);
    wrapper.appendChild(el("div", { class: "holding-note-actions" }, [save, cancel]));
    area.focus();
  };

  showText();
  return wrapper;
}

function holdingRowEl(priced, totalValue) {
  const { symbol, price, holding, levels, crossProximity } = priced;
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

  const crossTag = crossProximityEl(crossProximity);
  if (crossTag) {
    crossTag.style.padding = "0 14px 8px";
    children.push(crossTag);
  }

  const alertTag = holdingAlertTagEl(symbol, price);
  if (alertTag) children.push(alertTag);

  children.push(noteBlockEl(symbol));

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
const TAKE_PROFIT_BADGE_LABEL = { hit: "TP atteint", near: "TP proche", far: "TP loin" };

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
    const tpStatus = t.side === "BUY" ? takeProfitStatus(currentPrice, t.takeProfit) : null;

    // Couleur de la ligne: stop-loss casse > take-profit atteint > proche
    // (SL ou TP) > loin.
    let rowStatus = null;
    if (status === "red") rowStatus = "red";
    else if (tpStatus === "hit") rowStatus = "tp-hit";
    else if (status === "orange" || tpStatus === "near") rowStatus = "orange";
    else if (status === "green" || tpStatus === "far") rowStatus = "green";

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

      const tpInput = el("input", {
        type: "number",
        class: "history-stoploss-input",
        value: t.takeProfit != null ? t.takeProfit : "",
        inputmode: "decimal",
        step: "any",
      });
      tpInput.addEventListener("click", (e) => e.stopPropagation());
      tpInput.addEventListener("change", (e) => {
        const val = parseFloat(e.target.value);
        t.takeProfit = isNaN(val) ? null : val;
        savePortfolio();
        renderHistoryFor(symbol, container, currentPrice);
        renderPortfolioAlert();
      });

      const tpRow = [el("span", { textContent: "Take-profit :" }), tpInput];
      if (tpStatus) {
        tpRow.push(el("span", { class: `history-stoploss-badge tp-${tpStatus}`, textContent: TAKE_PROFIT_BADGE_LABEL[tpStatus] }));
      }
      children.push(el("div", { class: "history-stoploss" }, tpRow));
    }

    container.appendChild(el("div", { class: rowStatus ? `history-item stop-${rowStatus}` : "history-item" }, children));
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
      let crossProximity = null;
      if (candles.length > CONFIG.warmupPeriod) {
        const data = computeIndicators(candles);
        crossProximity = crossProximityStatus(data, data.length - 1);
        maybeNotifyCross(symbol, crossProximity);
      }
      priced.push({ symbol, price, holding: portfolio.holdings[symbol], levels, crossProximity });
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
  document.getElementById("trade-takeprofit-input").value = "";
  document.getElementById("trade-takeprofit-field").style.display = side === "BUY" ? "block" : "none";
  document.getElementById("trade-note-input").value = "";
  document.getElementById("trade-note-field").style.display = side === "BUY" ? "block" : "none";
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
      document.getElementById("trade-takeprofit-input").value = nearestResistance ? nearestResistance.price : "";
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
  let takeProfit = null;
  if (tradeState.side === "BUY") {
    const stopLossVal = parseFloat(document.getElementById("trade-stoploss-input").value);
    stopLoss = isNaN(stopLossVal) ? null : stopLossVal;
    const takeProfitVal = parseFloat(document.getElementById("trade-takeprofit-input").value);
    takeProfit = isNaN(takeProfitVal) ? null : takeProfitVal;

    // La note saisie a l'achat s'ajoute a celle de la position (sans l'ecraser).
    const noteText = document.getElementById("trade-note-input").value.trim();
    if (noteText) {
      const existing = getNote(symbol);
      setNote(symbol, existing ? `${existing}\n${noteText}` : noteText);
    }
  }

  executeTrade(symbol, tradeState.side, usdAmount, finalCryptoAmount, tradeState.price, stopLoss, takeProfit);
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
