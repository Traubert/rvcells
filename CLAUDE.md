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
- `src/engine/parser.ts` — cell input parser and recursive descent expression parser; supports cross-sheet refs (`Sheet.A1`, `'Sheet Name'.var`)
- `src/engine/parser.test.ts` — parser test suite (vitest)
- `src/engine/distributions.ts` — sampling from distributions (Box-Muller, Marsaglia-Tsang, inverse CDF)
- `src/engine/evaluate.ts` — global multi-sheet DAG evaluation, incremental recalculation, cycle detection, built-in functions, summary stats, histograms, sheet rename/delete helpers
- `src/engine/file.ts` — JSON file format v2 (multi-sheet), import/export with v1 backward compat
- `src/engine/fill.ts` — range fill logic with $ pin support
- `src/format.ts` — shared number formatting (3 significant figures)
- `src/components/Grid.tsx` — spreadsheet grid UI, keyboard navigation, formula bar
- `src/components/DetailPanel.tsx` — histogram, percentile stats, range lock/zoom controls
- `src/components/TabBar.tsx` — sheet tab bar with add/close/rename
- `src/components/ConfirmDialog.tsx` — reusable confirmation dialog

## Core Concepts

### Cell values
- **Scalars**: A plain number (or string). Stored as a single value, not expanded into a sample array — no memory cost for constants.
- **Distributions**: e.g. `Normal(100000, 15000)`. Stored as a sample array (Float64Array).
- **Formulas**: Start with `=`, e.g. `= B2 - B3`. Evaluate by operating on the resolved values of referenced cells. If all inputs are scalar, the result is scalar. If any input is a distribution (sample array), all scalar inputs are broadcast and the result is a sample array.

### Variables
A cell can optionally define a **named variable** by prefixing the content with `name = ...`. For example, typing `income = A2 * 1200` into a cell defines a variable `income` whose value is the result of the formula `A2 * 1200`. The variable can then be referenced by name in other formulas (e.g. `= income * 0.3`). Variables are just aliases for the cell they're defined in — they participate in the same DAG.

### Sample counts
- Default sample count is 10,000 per DAG. Configurable globally via Settings dialog (100–1,000,000).
- Eventually configurable per-DAG and per-cell. Per-cell overrides mean antecedent cells produce more samples to feed the high-resolution cell, while other dependents only use the prefix of the array they need.

### Evaluation model
The dependency graph is a DAG evaluated in topological order across all sheets (global topo sort). Each cell resolves to either a scalar or a sample array. Arithmetic on sample arrays is elementwise. Scalars broadcast when mixed with sample arrays. Editing a cell triggers incremental recalculation — only the edited cell and its downstream dependents (including cross-sheet) are re-evaluated. Duplicate variable names are detected and errored (first definition wins).

### Display
Each cell shows a compact summary: the value for scalars, mean ± std for distributions with color intensity encoding uncertainty (white = low CV, warm orange → red = high CV). Clicking a distribution cell opens a detail panel with histogram and percentile stats. The detail panel is suppressed for scalar cells.

## Feature List (prototype)

### P0 — core loop
- [x] Editable grid (26 columns × 50 rows)
- [x] Cell editing: type a number, a distribution spec, or a formula
- [x] Distribution types: Normal, LogNormal, Uniform, Triangular, Beta
- [x] Formula parser: arithmetic operators (+, -, *, /), cell references (A1, B2), parentheses, unary minus
- [x] Variable definitions: `name = expr` syntax in any cell, usable by name in other formulas
- [x] DAG-based recalculation on any cell edit, with cycle detection
  - Single-cell edits: detect cycle at edit time, reject/error the edited cell
  - Bulk operations (load, paste): topoSortWithCycles marks all cycle participants with errors, evaluates the rest
- [x] MC engine: sample arrays propagated through the DAG; scalars stay scalar until mixed with a distribution
- [x] Cell display: show mean for scalars, show mean ± spread indicator for distributions
- [x] Detail panel: click a cell to see its full empirical distribution as a histogram
- [x] Built-in functions: abs, sqrt, exp, log, pow, min, max, floor, ceil, round, clamp, if
- [x] Distribution constructors usable in formulas (e.g. `= Normal(100, 10) * 12`)
- [x] Incremental recalculation (only dirty cells and dependents)
- [x] Histogram hover showing per-bin percentage
- [x] Lockable histogram range with zoom +/− and recentre controls
- [x] Uncertainty-based cell coloring (CV → white-to-orange-to-red interpolation)
- [x] Label variables: `:= expr` derives variable name from text cell to the left
- [x] Keyboard shortcuts: Enter/F2 edit, direct typing, Ctrl+C/X/V copy/cut/paste, Ctrl+R recalc, Ctrl+Shift+R full recalc, Ctrl+H help
- [x] Settings dialog (global sample count)
- [x] Help dialog (two pages: basics and functions)
- [x] File naming (editable in header, used as export filename)
- [x] Tabbed sheets with add/close/rename, duplicate name prevention
- [x] Cross-sheet cell references (`Data.A1`) and variable references (`Data.income`)
- [x] Quoted sheet names for spaces (`'My Sheet'.A1`)
- [x] Sheet rename propagates to all cross-sheet references
- [x] Sheet delete warns if referenced, with in-app confirmation dialog
- [x] Bernoulli(p) and Discrete(p1, ..., pN) distributions
- [x] resample(cell): re-evaluate sub-DAG with fresh random draws
- [x] Multi-cell selection (Shift+Arrow) with bulk delete
- [x] Histogram guidelines (σ and percentile modes)
- [x] Range unit selector (value, σ, percentile) for locked range
- [x] Distribution comparison: overlay another cell's histogram (orange) with side-by-side stats

### P1 — analysis
- [x] Correlation tab: Spearman rank correlation of each distribution input with the output
- [x] Variance tab: r² variance contribution for each input
- [x] Tornado tab: one-at-a-time P5/P95 sweep with directional coloring (green=input high, red=input low)
- [x] Inline distribution sample capture for sensitivity analysis of formulas with embedded distributions
- [x] Deterministic mode for tornado evaluation (distribution constructors return expected values)
- [x] Percentile display (P5, P25, P50, P75, P95) in the detail panel
- [ ] Conditional formatting / heatmap coloring based on variance or spread

### P2 — usability
- [x] Import/export spreadsheet as JSON file (browser download/upload)
- [ ] Save/load to browser storage
- [ ] Undo/redo
- [ ] Cell formatting (labels, number formats)
- [ ] Functions on ranges: SUM, MEAN, etc.
- [x] Range fill: drag fill handle to copy cell with shifted references
- [x] $ pinning in cell references ($A1, A$1, $A$1)
- [ ] Resizable grid
- [x] Copy/cut/paste (Ctrl+C/X/V) with reference shifting and system clipboard (TSV)
- [x] Copy/cut resolved values (Ctrl+Shift+C/X) — scalars as numbers, distributions as mean ± std

### P3 — advanced
- [ ] Correlated inputs (specify correlation between distribution cells)
- [ ] Custom distributions (empirical, from pasted data)
- [ ] Multiple scenarios / side-by-side comparison
- [ ] Shareable via URL (encode state in URL or use a paste service)

## Design Principles

- **Immediate feedback**: recalculation should feel instant. 10k samples through a small DAG should take <10ms.
- **Progressive disclosure**: cells look like a normal spreadsheet at a glance; distribution details appear on interaction.
- **Prototype-first**: prefer simple implementations that work over polished ones that take longer. We can iterate.
