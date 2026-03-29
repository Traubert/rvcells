# rvcells Manual

## Distributions as first-class values

*TODO*

## Operations on distributions

### Everything is a distribution

*TODO*

## Variables

*TODO*

## The detail view

*TODO*

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
