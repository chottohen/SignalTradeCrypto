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
function executeTrade(symbol, side, usdAmount, cryptoAmount, price) {
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
  });
  savePortfolio();
}

function holdingRowEl(priced, totalValue) {
  const { symbol, price, holding } = priced;
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

  const history = el("div", { class: "holding-history", style: "display:none;" });
  renderHistoryFor(symbol, history);

  row.addEventListener("click", () => {
    const visible = history.style.display !== "none";
    history.style.display = visible ? "none" : "block";
  });

  return el("div", { class: "holding-wrapper" }, [row, history]);
}

function renderHistoryFor(symbol, container) {
  container.innerHTML = "";
  const txs = portfolio.transactions.filter((t) => t.symbol === symbol).slice().reverse();
  if (txs.length === 0) {
    container.appendChild(el("p", { class: "history-empty", textContent: "Aucune transaction." }));
    return;
  }
  txs.forEach((t) => {
    const sideLabel = t.side === "BUY" ? "Achat" : "Vente";
    const sideColor = t.side === "BUY" ? GREEN : RED;
    container.appendChild(
      el("div", { class: "history-item" }, [
        el("p", { class: "history-side", style: `color:${sideColor};`, textContent: sideLabel }),
        el("p", {
          class: "history-detail",
          textContent: `${formatPrice(t.cryptoAmount)} ${symbol} · ${formatPrice(t.usdAmount)} $ · ${formatPrice(t.price)} $/u`,
        }),
        el("p", { class: "history-date", textContent: new Date(t.timestamp).toLocaleString("fr-FR") }),
      ])
    );
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
      priced.push({ symbol, price: candles[candles.length - 1].close, holding: portfolio.holdings[symbol] });
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

  priced.sort((a, b) => b.price * b.holding.quantity - a.price * a.holding.quantity);
  container.innerHTML = "";
  priced.forEach((p) => container.appendChild(holdingRowEl(p, totalValue)));
}

// --- Formulaire d'achat/vente ---

let tradeState = { side: null, entry: null, price: null };

function openTradeModal(side) {
  tradeState = { side, entry: null, price: null };
  document.getElementById("trade-modal-title").textContent = side === "BUY" ? "Achat" : "Vente";
  document.getElementById("trade-symbol-input").value = "";
  document.getElementById("trade-usd-input").value = "";
  document.getElementById("trade-crypto-input").value = "";
  document.getElementById("trade-selected-info").textContent = "";
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
  try {
    const candles = await fetchCandles(entry);
    tradeState.entry = entry;
    tradeState.price = candles[candles.length - 1].close;
    document.getElementById("trade-selected-info").textContent = `${symbol} — cours actuel : ${formatPrice(tradeState.price)} $`;
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

  const symbol = tradeState.entry.symbol;
  if (tradeState.side === "BUY") {
    if (usdAmount > portfolio.cashUsd) {
      errorEl.textContent = `Montant supérieur au cash disponible (${formatPrice(portfolio.cashUsd)} $).`;
      errorEl.style.display = "block";
      return;
    }
  } else {
    const held = portfolio.holdings[symbol];
    if (!held || cryptoAmount > held.quantity) {
      errorEl.textContent = `Quantité supérieure à la position détenue (${held ? formatPrice(held.quantity) : 0} ${symbol}).`;
      errorEl.style.display = "block";
      return;
    }
  }

  executeTrade(symbol, tradeState.side, usdAmount, cryptoAmount, tradeState.price);
  closeTradeModal();
  renderPortfolioPage();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-buy").addEventListener("click", () => openTradeModal("BUY"));
  document.getElementById("btn-sell").addEventListener("click", () => openTradeModal("SELL"));
  document.getElementById("trade-cancel-btn").addEventListener("click", closeTradeModal);
  document.getElementById("trade-confirm-btn").addEventListener("click", confirmTrade);

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

  document.getElementById("trade-usd-input").addEventListener("input", (e) => {
    if (!tradeState.price) return;
    const usd = parseFloat(e.target.value);
    if (!isNaN(usd)) document.getElementById("trade-crypto-input").value = (usd / tradeState.price).toFixed(8);
  });
  document.getElementById("trade-crypto-input").addEventListener("input", (e) => {
    if (!tradeState.price) return;
    const qty = parseFloat(e.target.value);
    if (!isNaN(qty)) document.getElementById("trade-usd-input").value = (qty * tradeState.price).toFixed(2);
  });

  document.getElementById("trade-modal").addEventListener("click", (e) => {
    if (e.target.id === "trade-modal") closeTradeModal();
  });
});
