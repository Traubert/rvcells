/** Format a number to 3 significant figures, with locale thousands separators for large values. */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n === 0) return "0";

  const abs = Math.abs(n);

  // For large numbers, use locale formatting with appropriate decimals
  if (abs >= 1_000_000) {
    // 3 sig figs: 1,230,000 not 1,234,567
    const magnitude = Math.pow(10, Math.floor(Math.log10(abs)) - 2);
    const rounded = Math.round(n / magnitude) * magnitude;
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  if (abs >= 1000) {
    // 3 sig figs with locale separators
    return Number(n.toPrecision(3)).toLocaleString();
  }

  // For smaller numbers, toPrecision handles it well
  return Number(n.toPrecision(3)).toString();
}
