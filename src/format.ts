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

/** Format a number to the given significant figures, with SI suffixes above 1M. */
export function formatNumber(n: number, sigFigs = 3): string {
  if (!isFinite(n)) return String(n);
  if (n === 0) return "0";

  const abs = Math.abs(n);

  // For large numbers, use SI suffixes
  for (const [threshold, suffix] of SI_LARGE) {
    if (abs >= threshold) {
      const scaled = n / threshold;
      return Number(scaled.toPrecision(sigFigs)).toString() + suffix;
    }
  }

  // For small numbers, use SI suffixes
  if (abs > 0 && abs < 1e-3) {
    for (const [threshold, suffix] of SI_SMALL) {
      if (abs >= threshold * 0.999) {
        const scaled = n / threshold;
        return Number(scaled.toPrecision(sigFigs)).toString() + suffix;
      }
    }
  }

  if (abs >= 1000) {
    // sig figs with locale separators
    return Number(n.toPrecision(sigFigs)).toLocaleString();
  }

  // For smaller numbers, toPrecision handles it well
  return Number(n.toPrecision(sigFigs)).toString();
}

// ─── Cell format strings ─────────────────────────────────────────────
//
// A format string is a template containing one placeholder:
//   {}    the number, formatted to the cell's significant figures
//   {%}   the number ×100 with a % sign (0.5 → "50%")
//   {.n}  at most n decimals: fixed n decimals when the last significant
//         digit lands in the decimals, integer display otherwise (money:
//         {.2} shows 10.2 as "10.20" but 100.2 at 3 sig figs as "100").
//         Values below the last decimal show as 0 — never as SI-small
//         suffixes (0.0001 → "0.00", not "100μ"). Large values keep the
//         SI-large suffixes because those come from sig figs, not decimals.
// Everything around the placeholder is literal text ("{.2} €/kk").

export type PlaceholderSpec =
  | { kind: "plain" }
  | { kind: "percent" }
  | { kind: "fixed"; decimals: number };

const PLACEHOLDER_RE = /\{(%|\.(\d+))?\}/;

/** Split a format string at its first placeholder. Null if it has none. */
export function parseFormatString(
  s: string,
): { prefix: string; spec: PlaceholderSpec; suffix: string } | null {
  const m = PLACEHOLDER_RE.exec(s);
  if (!m) return null;
  const spec: PlaceholderSpec =
    m[1] === "%" ? { kind: "percent" }
    : m[2] !== undefined ? { kind: "fixed", decimals: parseInt(m[2], 10) }
    : { kind: "plain" };
  return { prefix: s.slice(0, m.index), spec, suffix: s.slice(m.index + m[0].length) };
}

export function hasPlaceholder(s: string): boolean {
  return PLACEHOLDER_RE.test(s);
}

/** Format one number according to a placeholder spec. */
export function formatNumberSpec(n: number, spec: PlaceholderSpec, sigFigs = 3): string {
  switch (spec.kind) {
    case "plain":
      return formatNumber(n, sigFigs);
    case "percent":
      return formatNumber(n * 100, sigFigs) + "%";
    case "fixed": {
      if (!isFinite(n)) return String(n);
      if (n === 0) return (0).toFixed(spec.decimals);
      // SI-large territory: fixed decimals don't apply to the scaled mantissa
      if (Math.abs(n) >= 1e6) return formatNumber(n, sigFigs);
      const rounded = Number(n.toPrecision(sigFigs));
      // Exponent of the least significant digit after sig-fig rounding:
      // negative means decimals survived → pad/cap to fixed decimals
      const lsdExp = Math.floor(Math.log10(Math.abs(rounded))) - (sigFigs - 1);
      if (lsdExp < 0) {
        const out = rounded.toLocaleString(undefined, {
          minimumFractionDigits: spec.decimals,
          maximumFractionDigits: spec.decimals,
        });
        // A value below the last decimal rounds to zero: drop the sign
        return out.replace(/^-(?=[0.,]*$)/, "");
      }
      return formatNumber(n, sigFigs);
    }
  }
}

/** Format a scalar with a cell's full format (sig figs + format string). */
export function formatValue(n: number, format?: { sigFigs?: number; formatString?: string }): string {
  const sigFigs = format?.sigFigs ?? 3;
  const parsed = format?.formatString ? parseFormatString(format.formatString) : null;
  if (!parsed) return formatNumber(n, sigFigs);
  return parsed.prefix + formatNumberSpec(n, parsed.spec, sigFigs) + parsed.suffix;
}
