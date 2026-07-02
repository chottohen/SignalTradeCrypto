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
      el("p", { class: "symbol", textContent: result.symbol.replace("USDT", "/USDT") }),
      el("p", { class: "price", textContent: `${formatPrice(result.close)} USDT` }),
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

function powerLawEl(info) {
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
    el("p", { class: "powerlaw-current", textContent: `Prix BTC actuel : ${formatPrice(info.currentPrice)} USDT` }),
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

async function processSymbol(symbol) {
  const candles = await fetchKlines(symbol);
  if (candles.length <= CONFIG.warmupPeriod) return null;

  let result = evaluate(symbol, candles);
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

  for (const symbol of watchlist) {
    setStatus(`Chargement… (${done + 1}/${watchlist.length}) ${symbol}`);
    try {
      const entry = await processSymbol(symbol);
      if (!entry) continue;

      if (!btcPowerLawRendered && symbol === "BTCUSDT") {
        const powerLawInfo = corridorPosition(entry.result.close);
        const container = document.getElementById("powerlaw-container");
        container.innerHTML = "";
        const node = powerLawEl(powerLawInfo);
        if (node) container.appendChild(node);
        btcPowerLawRendered = true;
      }

      cardsContainer.appendChild(cardEl(entry));
    } catch (e) {
      console.error(symbol, e);
    }
    done++;
  }

  setStatus(`Mis à jour à ${new Date().toLocaleTimeString("fr-FR")}`);
}

document.addEventListener("DOMContentLoaded", () => {
  loadApp();
  document.getElementById("refresh-btn").addEventListener("click", loadApp);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
});
