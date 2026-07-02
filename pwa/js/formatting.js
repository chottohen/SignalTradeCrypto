// Port de formatting.py
function formatPrice(value) {
  if (!value) return "0.00";
  const magnitude = Math.abs(value);
  if (magnitude >= 1) {
    return value
      .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .replace(/,/g, " ");
  }
  const decimals = Math.max(2, 3 - Math.floor(Math.log10(magnitude)));
  return value.toFixed(decimals);
}
