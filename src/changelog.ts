export interface ChangelogEntry {
  version: number;
  summary: string;
}

/**
 * Append new entries at the end. The version number is just an incrementing
 * integer — bump it each time you add an entry. The splash screen shows all
 * entries newer than the visitor's last-seen version.
 */
export const changelog: ChangelogEntry[] = [
  { version: 1, summary: "Tabbed multi-sheet workbooks with cross-sheet references" },
  { version: 2, summary: "Chain() and ChainIndex() for iterative Monte Carlo processes" },
  { version: 3, summary: "Timeline fan chart for Chain cells" },
  { version: 4, summary: "Sensitivity analysis: Correlation, Variance, and Tornado tabs" },
  { version: 5, summary: "Distribution comparison overlay in the detail panel" },
  { version: 6, summary: "Range fill with drag handle and $ pinning" },
  { version: 7, summary: "Save/load to browser storage, zip mass export/import" },
  { version: 8, summary: "Built-in example workbooks (Help \u2192 Examples)" },
  { version: 9, summary: "Pareto, Poisson, and Student\u2019s t distributions" },
  { version: 10, summary: "Histogram: P1\u2013P99 default range, stable bins, drag-to-pan" },
  { version: 11, summary: "Variable assignment with := syntax, unicode variable names" },
  { version: 12, summary: "SI suffix formatting for large and small numbers (M, G, T, \u2026 / \u03bc, n, p, \u2026)" },
  { version: 13, summary: "Comparison operators in formulas: ==, !=, >, <, >=, <=" },
  { version: 14, summary: "Markov() transition diagram syntax for Markov chains" },
  { version: 15, summary: "Range functions: sum, mean, median, P() with cell ranges (A1:A10) and chain step ranges (x[0:12])" },
  { version: 16, summary: "Undo/redo (Ctrl+Z / Ctrl+Y)" },
  { version: 17, summary: "Drag to reorder sheet tabs, scroll wheel to cycle between tabs" },
  { version: 18, summary: "Autosave to browser storage on every edit (toggle in Settings)" },
  { version: 19, summary: "Click a step in the Timeline fan chart to inspect its histogram" },
  { version: 20, summary: "ChainIndex(chain, condition) searches for first step where a condition holds" },
  { version: 21, summary: "Light mode \u2014 auto/dark/light theme toggle in Settings \u2192 Global" },
  { version: 22, summary: "Sobol and Effect sizes tabs in the detail panel; pick any inputs from the dependency graph" },
  { version: 23, summary: "Cut-deepener: collapse leaf inputs into their shared intermediate (\u2212/+ buttons next to grouped rows)" },
  { version: 24, summary: "Argless distribution forms (Normal(), LogNormal(), Uniform(), Triangular(), Poisson(), Bernoulli()) and percent-CV syntax for Normal/LogNormal: Normal(100, 10%) and LogNormal(100, 10%)" },
  { version: 25, summary: "± / +- shorthand for Normal: \"100 ± 10\", \"100 +- 10\", or \"150 +- 10%\"" },
];

export const CURRENT_VERSION = changelog[changelog.length - 1].version;

const STORAGE_KEY = "rvcells:lastSeenVersion";

/** Returns null for first-time visitors, or the last-seen version number. */
export function getLastSeenVersion(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const v = parseInt(raw, 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function setLastSeenVersion(version: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(version));
  } catch {
    // storage full or unavailable — silently ignore
  }
}
