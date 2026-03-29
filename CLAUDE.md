# rvcells

A spreadsheet application where **random variables are a first-class cell type**. Cells can hold scalar values, distribution specifications, or formulas. Monte Carlo simulation propagates distributions through the dependency graph, and users can inspect result distributions, sensitivity, and variance contributions.

## Architecture

- **Pure browser app** — no backend, single-process, static-file deployable
- **Tech stack**: TypeScript, React, Vite
- **Visualization**: D3 or Plotly.js for distribution charts
- **Persistence**: Download/upload JSON files (IndexedDB later if needed)
- **MC engine**: Sample arrays propagated elementwise through a dependency DAG

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
The dependency graph is a DAG evaluated in topological order. Each cell resolves to either a scalar or a sample array. Arithmetic on sample arrays is elementwise. Scalars broadcast when mixed with sample arrays.

### Display
Each cell shows a compact summary (mean, or mean ± std, or a sparkline). Clicking a cell opens a detail panel.

## Feature List (prototype)

### P0 — core loop
- [ ] Editable grid (fixed size is fine, e.g. 26 columns × 100 rows)
- [ ] Cell editing: type a number, a distribution spec, or a formula
- [ ] Distribution types: Normal, LogNormal, Uniform, Triangular, Beta
- [ ] Formula parser: arithmetic operators (+, -, *, /), cell references (A1, B2), parentheses, unary minus
- [ ] Variable definitions: `name = expr` syntax in any cell, usable by name in other formulas
- [ ] DAG-based recalculation on any cell edit, with cycle detection
  - Single-cell edits: detect cycle at edit time, reject/error the edited cell
  - TODO: bulk operations (load, paste) can introduce cycles with no single culprit — needs a different strategy (e.g. mark all cells in the cycle)
- [ ] MC engine: sample arrays propagated through the DAG; scalars stay scalar until mixed with a distribution
- [ ] Cell display: show mean for scalars, show mean ± spread indicator for distributions
- [ ] Detail panel: click a cell to see its full empirical distribution as a histogram

### P1 — analysis
- [ ] Sensitivity analysis: for a selected output cell, show rank correlation with each input
- [ ] Tornado diagram: visualize which inputs contribute most to output variance
- [ ] Percentile display (P5, P25, P50, P75, P95) in the detail panel
- [ ] Conditional formatting / heatmap coloring based on variance or spread

### P2 — usability
- [ ] Save/load spreadsheet as JSON file
- [ ] Undo/redo
- [ ] Cell formatting (labels, number formats)
- [ ] Functions beyond arithmetic: MIN, MAX, SUM over ranges, IF
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
