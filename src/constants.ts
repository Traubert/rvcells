export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";
export const DEFAULT_SHEET_NAME = "Untitled sheet";

export const DEFAULT_NUM_SAMPLES = 10_000;
export const MIN_NUM_SAMPLES = 100;
export const MAX_NUM_SAMPLES = 1_000_000;

export const DEFAULT_NUM_HISTOGRAM_BINS = 100;

/** Distribution names that can be entered directly into a cell without "=" (original casing). */
export const DISTRIBUTION_NAMES = new Set(["Normal", "LogNormal", "Uniform", "Triangular", "Beta"]);

/** All sample-producing constructor function names (lowercase, for evalFunc matching).
 *  Keep in sync with the cases in evalFunc. */
export const SAMPLE_CONSTRUCTORS = new Set([
  "normal", "lognormal", "uniform", "triangular", "beta", "bernoulli", "discrete",
]);
