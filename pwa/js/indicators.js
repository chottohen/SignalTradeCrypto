// Port de indicators.py

function ema(values, period) {
  const k = 2 / (period + 1);
  const result = new Array(values.length).fill(null);
  let prev = values[0];
  result[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

function sma(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

// Lissage de Wilder: equivalent a pandas .ewm(alpha=1/period, adjust=False).mean().
// Un NaN (ex: division 0/0 au tout premier jour de l'ADX) est ignore et garde
// la valeur precedente, comme pandas - sans ca, un seul NaN se propage a
// travers toute la recursion et contamine le reste de la serie.
function emaWilder(values, period) {
  const alpha = 1 / period;
  const result = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || Number.isNaN(v)) {
      result[i] = prev;
      continue;
    }
    prev = prev === null ? v : v * alpha + prev * (1 - alpha);
    result[i] = prev;
  }
  return result;
}

function rsi(closes, period = 14) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const avgGain = emaWilder(gains, period);
  const avgLoss = emaWilder(losses, period);
  return closes.map((_, i) => {
    if (avgLoss[i] === 0) return 100;
    const rs = avgGain[i] / avgLoss[i];
    return 100 - 100 / (1 + rs);
  });
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

function trueRange(candles) {
  const tr = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return tr;
}

function atr(candles, period = 14) {
  return emaWilder(trueRange(candles), period);
}

function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const atrSmooth = emaWilder(trueRange(candles), period);
  const plusDMSmooth = emaWilder(plusDM, period);
  const minusDMSmooth = emaWilder(minusDM, period);
  const plusDI = plusDMSmooth.map((v, i) => (100 * v) / atrSmooth[i]);
  const minusDI = minusDMSmooth.map((v, i) => (100 * v) / atrSmooth[i]);
  const dx = plusDI.map((v, i) => (100 * Math.abs(v - minusDI[i])) / (v + minusDI[i]));
  return emaWilder(dx, period);
}
