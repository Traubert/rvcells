# rvcells

A spreadsheet application where **random variables are a first-class cell type**. Cells can hold scalar values, distribution specifications, or formulas. Monte Carlo simulation propagates distributions through the dependency graph, and users can inspect result distributions, sensitivity, and variance contributions.

## Architecture

- **Pure browser app** — no backend, single-process, static-file deployable
- **Tech stack**: TypeScript, React, Vite
- **Visualization**: SVG histograms rendered in React (D3/Plotly considered for future)
- **Persistence**: Download/upload JSON files (IndexedDB later if needed)
- **MC engine**: Sample arrays propagated elementwise through a dependency DAG

### Source layout
- `src/engine/types.ts` — core types (CellResult, Distribution, Expr, Cell, Sheet)
- `src/engine/parser.ts` — cell input parser and recursive descent expression parser
- `src/engine/parser.test.ts` — parser test suite (vitest)
- `src/engine/distributions.ts` — sampling from distributions (Box-Muller, Marsaglia-Tsang, inverse CDF)
- `src/engine/evaluate.ts` — DAG evaluation, incremental recalculation, cycle detection, built-in functions, summary stats, histograms
- `src/engine/file.ts` — JSON file format, import/export (browser download/upload)
- `src/format.ts` — shared number formatting (3 significant figures)
- `src/components/Grid.tsx` — spreadsheet grid UI, keyboard navigation, formula bar
- `src/components/DetailPanel.tsx` — histogram, percentile stats, range lock/zoom controls

## Core Concepts

### Cell values
- **Scalars**: A plain number (or string). Stored as a single value, not expanded into a sample array — no memory cost for constants.
- **Distributions**: e.g. `Normal(100000, 15000)`. Stored as a sample array (Float64Array).
- **Formulas**: Start with `=`, e.g. `= B2 - B3`. Evaluate by operating on the resolved values of referenced cells. If all inputs are scalar, the result is scalar. If any input is a distribution (sample array), all scalar inputs are broadcast and the result is a sample array.

### Variables
A cell can optionally define a **named variable** by prefixing the content with `name = ...`. For example, typing `income = A2 * 1200` into a cell defines a variable `income` whose value is the result of the formula `A2 * 1200`. The variable can then be referenced by name in other formulas (e.g. `= income * 0.3`). Variables are just aliases for the cell they're defined in — they participate in the same DAG.

### Sample counts
- Default sample count is 10,000 per DAG.
- Eventually configurable globally, per-DAG, and per-cell. Per-cell overrides mean antecedent cells produce more samples to feed the high-resolution cell, while other dependents only use the prefix of the array they need.
- For now, a single global sample count is fine for the prototype.

### Evaluation model
The dependency graph is a DAG evaluated in topological order. Each cell resolves to either a scalar or a sample array. Arithmetic on sample arrays is elementwise. Scalars broadcast when mixed with sample arrays. Editing a cell triggers incremental recalculation — only the edited cell and its downstream dependents are re-evaluated.

### Display
Each cell shows a compact summary: the value for scalars, mean ± std for distributions with color intensity encoding uncertainty (white = low CV, teal = high CV). Clicking a distribution cell opens a detail panel with histogram and percentile stats. The detail panel is suppressed for scalar cells.

## Feature List (prototype)

### P0 — core loop
- [x] Editable grid (26 columns × 50 rows)
- [x] Cell editing: type a number, a distribution spec, or a formula
- [x] Distribution types: Normal, LogNormal, Uniform, Triangular, Beta
- [x] Formula parser: arithmetic operators (+, -, *, /), cell references (A1, B2), parentheses, unary minus
- [x] Variable definitions: `name = expr` syntax in any cell, usable by name in other formulas
- [x] DAG-based recalculation on any cell edit, with cycle detection
  - Single-cell edits: detect cycle at edit time, reject/error the edited cell
  - TODO: bulk operations (load, paste) can introduce cycles with no single culprit — needs a different strategy (e.g. mark all cells in the cycle)
- [x] MC engine: sample arrays propagated through the DAG; scalars stay scalar until mixed with a distribution
- [x] Cell display: show mean for scalars, show mean ± spread indicator for distributions
- [x] Detail panel: click a cell to see its full empirical distribution as a histogram
- [x] Built-in functions: abs, sqrt, exp, log, pow, min, max, floor, ceil, round, clamp, if
- [x] Distribution constructors usable in formulas (e.g. `= Normal(100, 10) * 12`)
- [x] Incremental recalculation (only dirty cells and dependents)
- [x] Histogram hover showing per-bin percentage
- [x] Lockable histogram range with zoom +/− and recentre controls
- [x] Uncertainty-based cell coloring (CV → white-to-teal interpolation)

### P1 — analysis
- [ ] Sensitivity analysis: for a selected output cell, show rank correlation with each input
- [ ] Tornado diagram: visualize which inputs contribute most to output variance
- [x] Percentile display (P5, P25, P50, P75, P95) in the detail panel
- [ ] Conditional formatting / heatmap coloring based on variance or spread

### P2 — usability
- [x] Import/export spreadsheet as JSON file (browser download/upload)
- [ ] Save/load to browser storage
- [ ] Undo/redo
- [ ] Cell formatting (labels, number formats)
- [ ] Functions on ranges: SUM, MEAN, etc.
- [ ] Resizable grid
- [ ] Copy/paste

### P3 — advanced
- [ ] Correlated inputs (specify correlation between distribution cells)
- [ ] Custom distributions (empirical, from pasted data)
- [ ] Multiple scenarios / side-by-side comparison
- [ ] Shareable via URL (encode state in URL or use a paste service)

## Design Principles

- **Immediate feedback**: recalculation should feel instant. 10k samples through a small DAG should take <10ms.
- **Progressive disclosure**: cells look like a normal spreadsheet at a glance; distribution details appear on interaction.
- **Prototype-first**: prefer simple implementations that work over polished ones that take longer. We can iterate.
