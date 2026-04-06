export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";
export const DEFAULT_SHEET_NAME = "Untitled sheet";

export const DEFAULT_NUM_SAMPLES = 10_000;
export const MIN_NUM_SAMPLES = 100;
export const MAX_NUM_SAMPLES = 1_000_000;

export const DEFAULT_NUM_HISTOGRAM_BINS = 100;

export const DEFAULT_CHAIN_SEARCH_LIMIT = 1_000;
export const MIN_CHAIN_SEARCH_LIMIT = 10;
export const MAX_CHAIN_SEARCH_LIMIT = 100_000;

/** Unicode-aware identifier character classes (letter/digit/underscore). */
export const ID_START = /[\p{L}_]/u;
export const ID_CONT = /[\p{L}\p{N}_]/u;
/** Source strings for embedding in larger regexes. */
export const ID_START_SRC = "[\\p{L}_]";
export const ID_CONT_SRC = "[\\p{L}\\p{N}_]";

/** Distribution names that can be entered directly into a cell without "=" (original casing). */
export const DISTRIBUTION_NAMES = new Set(["Normal", "LogNormal", "Uniform", "Triangular", "Beta", "Pareto", "Poisson", "StudentT"]);

/** All sample-producing constructor function names (lowercase, for evalFunc matching).
 *  Keep in sync with the cases in evalFunc. */
export const SAMPLE_CONSTRUCTORS = new Set([
  "normal", "lognormal", "uniform", "triangular", "beta", "pareto", "poisson", "studentt", "bernoulli", "discrete",
]);
