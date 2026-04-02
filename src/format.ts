const SI_LARGE: [number, string][] = [
  [1e24, "Y"],
  [1e21, "Z"],
  [1e18, "E"],
  [1e15, "P"],
  [1e12, "T"],
  [1e9,  "G"],
  [1e6,  "M"],
];

const SI_SMALL: [number, string][] = [
  [1e-6,  "μ"],
  [1e-9,  "n"],
  [1e-12, "p"],
  [1e-15, "f"],
  [1e-18, "a"],
  [1e-21, "z"],
  [1e-24, "y"],
];

/** Format a number to 3 significant figures, with SI suffixes above 1M. */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return String(n);
  if (n === 0) return "0";

  const abs = Math.abs(n);

  // For large numbers, use SI suffixes
  for (const [threshold, suffix] of SI_LARGE) {
    if (abs >= threshold) {
      const scaled = n / threshold;
      return Number(scaled.toPrecision(3)).toString() + suffix;
    }
  }

  // For small numbers, use SI suffixes
  if (abs > 0 && abs < 1e-3) {
    for (const [threshold, suffix] of SI_SMALL) {
      if (abs >= threshold * 0.999) {
        const scaled = n / threshold;
        return Number(scaled.toPrecision(3)).toString() + suffix;
      }
    }
  }

  if (abs >= 1000) {
    // 3 sig figs with locale separators
    return Number(n.toPrecision(3)).toLocaleString();
  }

  // For smaller numbers, toPrecision handles it well
  return Number(n.toPrecision(3)).toString();
}
