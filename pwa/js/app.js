// Port de html_report.py — rendu DOM cote client, memes couleurs/regles.

const LABEL_STYLE = {
  ACHAT: { text: "Achat", bg: "#EAF3DE", color: "#173404", border: null },
  VENTE: { text: "Vente", bg: "#FCEBEB", color: "#501313", border: null },
  CALME: { text: "Calme", bg: "#F1EFE8", color: "#2C2C2A", border: null },
  ALLEGER: { text: "Alléger", bg: "#FAEEDA", color: "#412402", border: null },
  RENFORCER: { text: "Renforcer", bg: "#FFFFFF", color: "#173404", border: "#3B6D11" },
  A_SURVEILLER: { text: "A surveiller", bg: "#FFFFFF", color: "#2C2C2A", border: "#888780" },
};
const GREEN = "#3B6D11";
const RED = "#A32D2D";
const AMBER = "#854F0B";
const GRAY = "#5F5E5A";

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "style") node.setAttribute("style", v);
    else node[k] = v;
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

function badgeEl(label) {
  const style = LABEL_STYLE[label] || LABEL_STYLE.A_SURVEILLER;
  const borderCss = style.border ? `border:1px solid ${style.border};` : "border:none;";
  return el("span", {
    class: "badge",
    style: `background:${style.bg};color:${style.color};${borderCss}`,
    textContent: style.text,
  });
}

function variationCell(label, value) {
  let color = GRAY;
  let arrow = "▪";
  let text = "n/d";
  if (value !== null && value !== undefined) {
    if (Math.abs(value) < 0.1) {
      color = GRAY;
      arrow = "▪";
    } else if (value > 0) {
      color = GREEN;
      arrow = "▲";
    } else {
      color = RED;
      arrow = "▼";
    }
    text = `${arrow} ${Math.abs(value).toFixed(1)}%`;
  }
  return el("div", {}, [
    el("p", { class: "var-label", textContent: label }),
    el("p", { class: "var-value", style: `color:${color};`, textContent: text }),
  ]);
}

function levelBlock(kindLabel, level, currentPrice, highlightColor, bordered) {
  if (!level) return null;
  const distancePct = ((level.price - currentPrice) / currentPrice) * 100;
  const distanceAbs = level.price - currentPrice;
  const days = Math.floor((Date.now() - level.lastTouch) / (1000 * 3600 * 24));
  const color = highlightColor || "#2C2C2A";
  const metaColor = highlightColor || GRAY;
  const weight = highlightColor ? "600" : "400";
  const sign = distanceAbs >= 0 ? "+" : "-";

  return el("div", { class: bordered ? "level-block bordered" : "level-block" }, [
    el("div", { class: "level-top" }, [
      el("p", { class: "level-label", style: `color:${color};font-weight:${weight};`, textContent: kindLabel }),
      el("p", { class: "level-price", textContent: formatPrice(level.price) }),
    ]),
    el("p", {
      class: "level-meta",
      style: `color:${metaColor};`,
      textContent: `${distancePct >= 0 ? "+" : ""}${distancePct.toFixed(1)}% (${sign}${formatPrice(Math.abs(distanceAbs))}) · touché il y a ${days} j`,
    }),
  ]);
}

function supertrendEl(status) {
  if (!status) return null;
  const color = status.direction === "HAUSSIER" ? GREEN : RED;
  const flipNote = status.flippedToday ? " · retournement aujourd'hui" : "";
  return el("p", {
    class: "supertrend-tag",
    style: `color:${color};`,
    textContent: `Supertrend (suivi serré) : ${status.direction.toLowerCase()} depuis ${status.daysInDirection} j${flipNote}`,
  });
}

function cardEl(entry) {
  const { result, trendAlert, levels, variations, supertrend } = entry;
  const { label: displayLabel, watchLevel } = resolveDisplayLabel(result.signal, result.close, levels);
  const { nearestSupport, nearestResistance } = nearestPair(levels, result.close);

  const supportColor = watchLevel === nearestSupport && displayLabel === "RENFORCER" ? GREEN : null;
  const resistanceColor = watchLevel === nearestResistance && displayLabel === "ALLEGER" ? AMBER : null;

  const header = el("div", { class: "card-header" }, [
    el("div", {}, [
      el("p", { class: "symbol", textContent: `${result.symbol}/${result.quote}` }),
      el("p", { class: "price", textContent: `${formatPrice(result.close)} ${result.quote}` }),
    ]),
    badgeEl(displayLabel),
  ]);

  const rationale = el("p", { class: "rationale", textContent: result.rationale });

  const variationsRow = el("div", { class: "variations" }, [
    variationCell("Veille", variations.d1),
    variationCell("7 jours", variations.d7),
    variationCell("30 jours", variations.d30),
  ]);

  const children = [header, rationale, supertrendEl(supertrend)];

  if (displayLabel === "RENFORCER" && watchLevel) {
    children.push(
      el("p", {
        class: "rationale",
        textContent: `Prix proche d'un support (${watchLevel.horizon}) — zone d'opportunité pour ajouter à une position existante.`,
      })
    );
  } else if (displayLabel === "ALLEGER" && watchLevel) {
    children.push(
      el("p", {
        class: "rationale",
        textContent: `Prix proche d'une résistance (${watchLevel.horizon}) — zone de prudence, envisager de réduire l'exposition.`,
      })
    );
  }

  if (trendAlert) {
    children.push(
      el("div", { class: "alert-box", style: "background:#FCEBEB;color:#501313;" }, `⚠ ${trendAlert.rationale}`)
    );
  }

  children.push(variationsRow);
  children.push(levelBlock("Résistance", nearestResistance, result.close, resistanceColor, true));
  children.push(levelBlock("Support", nearestSupport, result.close, supportColor, false));

  if (result.signal === "ACHAT" || result.signal === "VENTE") {
    children.push(
      el("div", { class: "level-block bordered" }, [
        el("p", { class: "level-label", textContent: "Stop-loss / Take-profit" }),
        el("p", {
          class: "level-meta",
          textContent: `${formatPrice(result.stopLoss)} / ${formatPrice(result.takeProfit)}`,
        }),
      ])
    );
  }

  return el("div", { class: "card" }, children);
}

function powerLawEl(info, quote = "USDT") {
  if (!info) return null;
  const pct = info.positionPct;
  let color;
  if (pct < 20) color = "#3B6D11";
  else if (pct < 45) color = "#639922";
  else if (pct < 65) color = GRAY;
  else if (pct < 85) color = AMBER;
  else color = RED;

  return el("div", { class: "powerlaw-box" }, [
    el("div", { class: "powerlaw-top" }, [
      el("span", { style: `font-weight:600;color:${color};`, textContent: `${info.label} — ${pct.toFixed(0)}% du corridor` }),
      el("span", { style: "color:#5F5E5A;", textContent: `exposant : ${POWER_LAW_PARAMS.n.toFixed(2)}` }),
    ]),
    el("div", { class: "powerlaw-bar" }, [el("div", { class: "powerlaw-marker", style: `left:${pct.toFixed(1)}%;` })]),
    el("div", { class: "powerlaw-labels" }, [
      el("span", { textContent: formatPrice(info.lowerBand) }),
      el("span", { textContent: `ligne centrale : ${formatPrice(info.centralPrice)}` }),
      el("span", { textContent: formatPrice(info.upperBand) }),
    ]),
    el("p", { class: "powerlaw-current", textContent: `Prix BTC actuel : ${formatPrice(info.currentPrice)} ${quote}` }),
  ]);
}

function renderMacro(fundamentals) {
  const row = document.getElementById("macro-row");
  row.innerHTML = "";
  row.appendChild(
    el("div", {
      class: "macro-chip",
      textContent:
        fundamentals.btcDominance !== null
          ? `Dominance BTC : ${fundamentals.btcDominance.toFixed(2)}%`
          : "Dominance BTC : indisponible",
    })
  );
  row.appendChild(
    el("div", {
      class: "macro-chip",
      textContent: fundamentals.fearGreed
        ? `Fear & Greed : ${fundamentals.fearGreed.value} (${fundamentals.fearGreed.classification})`
        : "Fear & Greed : indisponible",
    })
  );
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function renderCards(entries) {
  const container = document.getElementById("cards");
  container.innerHTML = "";
  entries.forEach((entry) => container.appendChild(cardEl(entry)));
}

// Fiches par defaut (top 10) gardees en memoire pour un retour instantane
// quand la recherche est effacee, sans re-telecharger les donnees.
let defaultEntries = [];
let searchUniverseCache = null;
let searchActive = false;

async function processSymbol(watchlistEntry) {
  const candles = await fetchCandles(watchlistEntry);
  if (candles.length <= CONFIG.warmupPeriod) return null;

  let result = evaluate(watchlistEntry.symbol, candles);
  result.quote = watchlistEntry.quote;
  result.venue = watchlistEntry.venue;
  result = applyRiskManagement(result);

  const data = computeIndicators(candles);
  const trendAlert = detectTrendReversalAt(data, data.length - 1);
  const supertrend = supertrendStatus(candles);
  const levels = analyzeSymbol(candles);
  const variations = computeVariations(candles);

  return { result, trendAlert, supertrend, levels, variations };
}

async function loadApp() {
  setStatus("Chargement…");
  defaultEntries = [];
  const cardsContainer = document.getElementById("cards");
  cardsContainer.innerHTML = "";

  let watchlist;
  try {
    watchlist = await getWatchlist(CONFIG.watchlistSize);
  } catch (e) {
    setStatus("Erreur: impossible de récupérer la liste des actifs (" + e.message + ")");
    return;
  }

  fetchFundamentals().then(renderMacro);

  let btcPowerLawRendered = false;
  let done = 0;

  for (const watchlistEntry of watchlist) {
    setStatus(`Chargement… (${done + 1}/${watchlist.length}) ${watchlistEntry.symbol}`);
    try {
      const entry = await processSymbol(watchlistEntry);
      if (!entry) continue;

      if (!btcPowerLawRendered && watchlistEntry.symbol === "BTC") {
        const powerLawInfo = corridorPosition(entry.result.close);
        const container = document.getElementById("powerlaw-container");
        container.innerHTML = "";
        const node = powerLawEl(powerLawInfo, watchlistEntry.quote);
        if (node) container.appendChild(node);
        btcPowerLawRendered = true;
      }

      defaultEntries.push(entry);
      if (!searchActive) cardsContainer.appendChild(cardEl(entry));
    } catch (e) {
      console.error(watchlistEntry.symbol, e);
    }
    done++;
  }

  if (!searchActive) {
    setStatus(`Mis à jour à ${new Date().toLocaleTimeString("fr-FR")}`);
  }
}

// --- Recherche (top 100, une seule fiche affichee a la selection) ---

async function getSearchUniverse() {
  if (!searchUniverseCache) {
    searchUniverseCache = await getWatchlist(100);
  }
  return searchUniverseCache;
}

function showSuggestions(matches) {
  const box = document.getElementById("search-suggestions");
  box.innerHTML = "";
  if (matches.length === 0) {
    box.appendChild(el("div", { class: "suggestion-empty", textContent: "Aucun résultat dans le top 100." }));
    box.style.display = "block";
    return;
  }
  matches.slice(0, 8).forEach((watchlistEntry) => {
    const item = el("div", {
      class: "suggestion-item",
      textContent: `${watchlistEntry.symbol}/${watchlistEntry.quote}`,
    });
    item.addEventListener("click", () => selectSearchSymbol(watchlistEntry));
    box.appendChild(item);
  });
  box.style.display = "block";
}

function hideSuggestions() {
  document.getElementById("search-suggestions").style.display = "none";
}

async function selectSearchSymbol(watchlistEntry) {
  const display = `${watchlistEntry.symbol}/${watchlistEntry.quote}`;
  document.getElementById("search-input").value = display;
  hideSuggestions();
  document.getElementById("search-clear").style.display = "block";
  searchActive = true;

  setStatus(`Chargement de ${display}…`);
  document.getElementById("cards").innerHTML = "";
  try {
    const entry = await processSymbol(watchlistEntry);
    if (entry) {
      renderCards([entry]);
      setStatus(`Résultat pour ${display}`);
    } else {
      setStatus(`Historique insuffisant pour ${display}`);
    }
  } catch (e) {
    setStatus(`Erreur: ${e.message}`);
  }
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  document.getElementById("search-clear").style.display = "none";
  hideSuggestions();
  searchActive = false;
  renderCards(defaultEntries);
  setStatus(`Mis à jour à ${new Date().toLocaleTimeString("fr-FR")}`);
}

document.addEventListener("DOMContentLoaded", () => {
  loadApp();
  document.getElementById("refresh-btn").addEventListener("click", loadApp);

  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");

  searchInput.addEventListener("input", async (e) => {
    const query = e.target.value.trim().toUpperCase();
    searchClear.style.display = query ? "block" : "none";

    if (!query) {
      clearSearch();
      return;
    }

    const universe = await getSearchUniverse();
    const matches = universe.filter((watchlistEntry) => watchlistEntry.symbol.includes(query));
    showSuggestions(matches);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const box = document.getElementById("search-suggestions");
    const first = box.querySelector(".suggestion-item");
    if (first) first.click();
  });

  searchClear.addEventListener("click", clearSearch);

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) hideSuggestions();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});
