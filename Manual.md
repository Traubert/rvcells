# rvcells Manual

## Distributions as first-class values

In a traditional spreadsheet, every cell holds a single value. In rvcells, a cell can hold a **probability distribution** — an uncertain quantity represented by thousands of Monte Carlo samples.

To enter a distribution, just type it into a cell:

```
Normal(100000, 15000)
```

This creates a normally distributed random variable with mean 100,000 and standard deviation 15,000. Under the hood, rvcells immediately draws 10,000 samples from this distribution and stores them as the cell's value.

The available distribution types are:

| Distribution | Syntax | Description |
|---|---|---|
| Normal | `Normal(mean, std)` | Gaussian / bell curve |
| Log-Normal | `LogNormal(mu, sigma)` | Exponential of a normal (always positive) |
| Uniform | `Uniform(low, high)` | Equal probability across a range |
| Triangular | `Triangular(low, mode, high)` | Triangle-shaped, with a most likely value |
| Beta | `Beta(alpha, beta)` | Flexible shape on [0, 1], useful for probabilities |
| Bernoulli | `Bernoulli(p)` | 0 or 1 with probability p (coin flip) |
| Discrete | `Discrete(p1, p2, ...)` | Samples from {0, 1, 2, ...} with given probabilities |

You can also type a plain number like `42` — this is a scalar, which rvcells treats as a value with no uncertainty. Scalars use no extra memory; they're only expanded to match a distribution's sample count when combined with one in a formula.

*TODO: Screenshot — a few cells with distributions and scalars, showing the grid display*

## Operations on distributions

Formulas in rvcells start with `=`, just like a conventional spreadsheet:

```
= A1 + B1
= A1 * 1.1
= max(A1, 0)
```

When a formula references distribution cells, the arithmetic happens **elementwise across all samples**. If A1 holds 10,000 samples from `Normal(100, 10)` and B1 holds 10,000 samples from `Normal(50, 5)`, then `= A1 + B1` produces 10,000 samples where sample *i* is `A1[i] + B1[i]`. The result is itself a distribution — the sum of two normals.

All built-in functions work the same way:

| Function | Description |
|---|---|
| `abs(x)` | Absolute value |
| `sqrt(x)` | Square root |
| `exp(x)` | Exponential (e^x) |
| `log(x)`, `ln(x)` | Natural logarithm |
| `log10(x)` | Base-10 logarithm |
| `pow(x, y)` | x raised to power y |
| `min(x, y)`, `max(x, y)` | Smaller / larger of two values |
| `floor(x)`, `ceil(x)`, `round(x)` | Rounding |
| `clamp(x, lo, hi)` | Constrain x to the range [lo, hi] |
| `if(cond, then, else)` | Per-sample conditional (cond > 0 picks *then*) |

Distributions can also be used directly in formulas. This is equivalent to creating a distribution in a separate cell and referencing it, except that the samples are generated fresh each time the formula is evaluated:

```
= Normal(100, 10) * 12
= A1 + Uniform(-5, 5)
```

### Everything is a distribution

A useful mental model: in rvcells, *every* value is a distribution. A scalar like `42` is just a distribution with zero uncertainty — a spike at a single point. When you mix scalars and distributions in a formula, the scalar is broadcast to match: `100 + Normal(0, 10)` adds 100 to each of the 10,000 samples.

This means you don't need to think about whether a cell is "scalar" or "distribution" when writing formulas. The same formula works either way. If all inputs happen to be scalar, the result is scalar (no samples allocated). As soon as any input is a distribution, the result becomes one too.

The cell display reflects this: scalar cells show their value in white, while distribution cells show the mean with a ± indicator. The colour shifts from white toward teal as uncertainty increases, giving you an at-a-glance sense of which cells carry the most risk.

*TODO: Screenshot — a formula chain where some inputs are scalar and some are distributions, showing the colour gradient*

## Variables

Any cell can define a **named variable** by prefixing its content with a name and `=`:

```
income = Normal(8000, 1000)
tax_rate = 0.3
net = income * (1 - tax_rate)
```

The variable name can then be used in formulas in other cells:

```
= income * 12
= net * 0.9
```

Variable names are case-insensitive (`Income` and `income` refer to the same thing) and can contain letters, digits, and underscores.

### Label variables

A convenient shorthand: if the cell to the left of a cell contains text, you can use `:=` instead of `=` and the text will automatically become the variable name:

```
A1: Monthly income       B1: := Normal(8000, 1000)
A2: Tax rate             B2: := 0.3
A3: Net income           B3: := monthly_income * (1 - tax_rate)
```

Here, B1 automatically gets the variable name `monthly_income` (derived from the text in A1 — lowercased, spaces replaced with underscores). This keeps your sheet readable without having to repeat the name inside the formula.

If you change the label text, the variable name updates automatically and formulas referencing the old name will show an error until you update them.

## The detail view

Clicking on a distribution cell opens the **detail panel** at the bottom of the screen. It shows three things side by side:

**Summary statistics** (left panel): Mean, standard deviation, and percentiles (P5, P25, P50/median, P75, P95). These give you a quick numeric summary of the distribution's shape and spread.

**Histogram** (centre): A visual representation of the distribution. Hover over any bar to see the exact range and what percentage of samples fall in that bin.

**Controls** (right panel):

- **Guides** — cycle between three modes:
  - *Off*: no overlay lines
  - *σ*: vertical lines at the mean and ±1, 2, 3 standard deviations
  - *P%*: vertical lines at P5, P25, P50, P75, P95

  Each guideline shows its label on one side and the corresponding numeric value on the other.

- **Lock range** — fixes the histogram's x-axis range. This is essential for comparing distributions: lock the range on one cell, then click between different distribution cells to see them on the same scale. When locked, additional controls appear:
  - *+/−* buttons to zoom in/out (keeping the centre fixed)
  - *Range unit* toggle — cycle between natural values, standard deviations (σ), and percentiles (P%) for the range inputs
  - Numeric min/max fields for precise control
  - *Recentre* button (appears when the current cell's median doesn't match the range centre)

The detail panel only appears for distribution cells. Scalar cells don't have a distribution to display. It also hides during multi-cell selection.

*TODO: Screenshot — the detail panel showing a distribution with σ guidelines active and the range locked*

### Navigating with locked range

A typical workflow for comparing distributions:

1. Click a distribution cell of interest
2. Check "Lock range" — the current range is captured
3. Use arrow keys to navigate to other distribution cells
4. Each cell's histogram is drawn on the same x-axis scale, making visual comparison immediate
5. Use the +/− buttons or recentre if needed
6. Uncheck "Lock range" to return to auto-scaling

## Range fill

To copy a formula across multiple cells, use the **fill handle** — a small blue square at the bottom-right corner of the selected cell. Drag it down, up, left, or right to fill cells with copies of the formula.

Cell references in the formula are automatically adjusted:

```
C1: = A1 + B1
C2: = A2 + B2    (filled down — row references shifted by 1)
C3: = A3 + B3    (shifted by 2)
```

### Pinning with $

Prefix a column letter or row number with `$` to prevent it from shifting during fill:

| Reference | Column shifts? | Row shifts? |
|---|---|---|
| `A1` | Yes | Yes |
| `$A1` | No | Yes |
| `A$1` | Yes | No |
| `$A$1` | No | No |

For example, if B1 contains a tax rate and you want every row to reference it:

```
C1: = A1 * $B$1       (B1 is pinned)
C2: = A2 * $B$1       (filled down — A1 shifted to A2, B1 stayed)
C3: = A3 * $B$1
```

Variable references (like `income`) are never shifted — they always refer to the same cell regardless of fill direction.

## Time-dependent processes

### The problem with reusing samples

In rvcells, a distribution cell holds a fixed array of samples. When you reference that cell in a formula, you get those exact samples. This is usually what you want — it preserves correlations within a single computation.

But it becomes a problem when modelling processes that evolve over time. Consider a simple investment that grows by a random factor each month:

```
A1: 1000                           (initial investment)
A2: = A1 * Normal(1.05, 0.10)     (month 1)
A3: = A2 * Normal(1.05, 0.10)     (month 2, filled down from A2)
...
```

This works correctly because each cell has its own `Normal(1.05, 0.10)`, generating independent samples — the fill handle creates a fresh distribution in each row.

But suppose the monthly return is computed by a more complex formula elsewhere in the sheet:

```
B1: Normal(1.05, 0.10)            (monthly return factor)
A1: 1000
A2: = A1 * B1
A3: = A2 * B1                     (same B1 — same samples!)
```

Now A2 and A3 both reference B1, so they use the *same* random draws. In sample index 42, if B1 happened to draw 0.95, then A2 *and* A3 both multiply by 0.95. The result is that every month has the same "luck" — the variance grows much faster than it should, because good months are always good and bad months are always bad.

### Fresh samples with `resample()`

The `resample()` function solves this. It takes a cell reference and re-evaluates the entire computation that produced that cell's value, but with fresh random numbers at every distribution leaf:

```
B1: Normal(1.05, 0.10)            (monthly return factor)
A1: 1000
A2: = A1 * resample(B1)           (fresh draw from B1's distribution)
A3: = A2 * resample(B1)           (another fresh draw)
```

Now each month gets independent samples. `resample(B1)` has the same mean and standard deviation as B1, but different random draws. This is especially valuable when B1 is itself the result of a complex formula — `resample()` re-executes the entire sub-DAG that produces B1, resampling all the distributions along the way.

### Markov chains

A Markov chain models a process where the next state depends only on the current state, with random transitions. In rvcells, you can build these using `if()` and `Bernoulli()`.

**Example: employment status.** Suppose each month, an employed person has a 5% chance of losing their job, and an unemployed person has a 20% chance of finding one.

```
A1: Employment
B1: := 1                                             (1 = employed, 0 = not)
B2: := if(B1, Bernoulli(0.95), Bernoulli(0.20))     (transition)
B3–B12: (fill down from B2)
```

Here's how this works:

- `B1` starts at 1 (employed). Since this is a scalar, it's broadcast — all 10,000 samples start employed.
- In `B2`, `if()` operates elementwise across all samples. For each sample index *i*:
  - If B1[i] > 0 (employed): draw from `Bernoulli(0.95)` — 95% chance of staying employed.
  - If B1[i] = 0 (unemployed): draw from `Bernoulli(0.20)` — 20% chance of becoming employed.
- Each subsequent row does the same, using the previous row's state.

The result is that each of the 10,000 samples follows its own independent Markov path through the employment states. By row 12, the distribution over states has converged toward the stationary distribution (here, about 80% employed).

You can then use the employment state in further calculations:

```
C1: Income
D1: := if(B1, Normal(5000, 500), Normal(1500, 300))
D2–D12: (fill down)
```

Each sample's income depends on whether that particular sample is employed or not in that month — giving you a realistic income distribution that accounts for the possibility of job loss.

**Other distributions for state transitions.** For chains with more than two states, use `Discrete()`:

```
= Discrete(0.8, 0.15, 0.05)
```

This returns 0 with probability 80%, 1 with probability 15%, and 2 with probability 5%. Combined with nested `if()` calls or arithmetic on the state values, you can build arbitrarily complex multi-state Markov chains.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Enter / F2 | Edit selected cell |
| = | Start a new formula |
| Delete / Backspace | Clear selected cell(s) |
| Escape | Cancel edit, or clear selection, or deselect |
| Arrow keys | Navigate between cells |
| Shift + Arrow | Extend multi-cell selection |
| Tab | Commit edit and move right |
| R | Recalculate current cell and its dependents |
| Shift+R | Recalculate entire sheet |
| H | Open help screen |

## Saving and loading

Use the **rvcells** menu (top left) to import and export sheets as JSON files. The file stores the raw text of every cell, the sheet name, and settings like the sample count. Cell values are recomputed on load.

The sheet name (editable in the top centre of the screen) is used as the filename when exporting.

## Settings

Open **rvcells menu > Settings** to change the global sample count. The default is 10,000 samples per distribution. More samples give smoother histograms and more stable statistics, but slow down recalculation. The range is 100 to 1,000,000.

After changing the sample count, all cells are fully recalculated with the new count.
