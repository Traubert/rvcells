<p align="center">
  <img src="public/favicon.svg" alt="rvcells logo" width="200" height="200">
</p>

# rvcells

A spreadsheet where **random variables are a first-class cell type**. Define uncertain values as probability distributions, write formulas that combine them, and see how uncertainty propagates through your model via Monte Carlo simulation.

## What it does

- **Distributions as values.** Type `Normal(100000, 15000)` into a cell and it becomes a random variable — 10,000 samples drawn from that distribution. Also supports `LogNormal`, `Uniform`, `Triangular`, and `Beta`.
- **Arithmetic on distributions.** Formulas like `= A1 + B1` work elementwise across samples. If any input is a distribution, the output is a distribution. Scalars stay scalar until mixed with a distribution — no wasted memory.
- **Named variables.** Type `income = Normal(8000, 1000)` to define a variable. Other cells can reference it by name: `= income * 12`.
- **Incremental recalculation.** Editing a cell only recomputes that cell and its downstream dependents, not the whole sheet.
- **Visual uncertainty.** Cell text color interpolates from white (deterministic) to teal (high uncertainty) based on the coefficient of variation.
- **Detail panel.** Click a distribution cell to see its histogram, percentiles, and summary statistics. The histogram supports hover to see per-bin percentages.
- **Lockable histogram range.** Lock the x-axis range to compare distributions on the same scale, with zoom +/− buttons and a recentre control.
- **Built-in functions.** `abs`, `sqrt`, `exp`, `log`, `pow`, `min`, `max`, `floor`, `ceil`, `round`, `clamp`, `if` — all work elementwise on distributions.
- **Chain processes.** `Chain(wealth * return, 1000)` defines an iterative Monte Carlo process in a single cell. Referenced distributions are auto-resampled each step. Access any step with `ChainIndex()`, or view the full trajectory as a fan chart in the Timeline tab.
- **Sensitivity analysis.** Correlation, variance contribution, and tornado diagram tabs show how each input distribution affects the output.
- **Browser storage.** Save/load workbooks to localStorage (Ctrl+S/O), with mass export/import as zip.
- **Cycle detection.** Circular references are caught at edit time and shown as an error on the offending cell.

## Tech stack

- **TypeScript + React + Vite** — pure client-side, no backend
- **Monte Carlo engine** — `Float64Array` sample vectors propagated through a dependency DAG in topological order
- **Distribution sampling** — Box-Muller for normals, Marsaglia-Tsang for gamma/beta, inverse CDF for triangular/uniform
- **Formula parser** — hand-written recursive descent parser supporting arithmetic, cell references, variable references, and function calls
- **Visualization** — SVG histograms rendered directly in React

## Running

```bash
npm install
npm run dev
```

Then open http://localhost:5173/.

## Production build

```bash
npm run build
npx vite preview
```

The development server (`npm run dev`) uses React's development mode JSX runtime, which adds significant overhead. Production builds are fast. Use `npm run build` + `npx vite preview` for the real experience.

## Tests

```bash
npx vitest run
```

## License

GPL-3.0 — see [LICENSE](LICENSE).
