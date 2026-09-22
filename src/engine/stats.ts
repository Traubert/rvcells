/**
 * Numerically stable sample statistics (Welford's online algorithm).
 *
 * A naive Σx / n grows partial sums to n·|mean|, where each addition rounds at
 * the spacing of a double at that magnitude. For an array of 10k identical
 * non-integer values the mean comes back off by ~1e-8, and since every
 * deviation from that mean is then exactly the error, the reported std is
 * non-zero instead of 0. Welford's update m += (x − m)/k never forms the big
 * sum: after the first element m equals x exactly, so all later deltas are 0
 * and a constant array yields mean = x and variance = 0 bit-exactly.
 */

/** Mean of vals[from..to). */
export function sampleMean(vals: ArrayLike<number>, from = 0, to = vals.length): number {
  let m = 0;
  for (let i = from; i < to; i++) m += (vals[i] - m) / (i - from + 1);
  return m;
}

/** Mean of get(i) for i in [0, count). */
export function sampleMeanBy(count: number, get: (i: number) => number): number {
  let m = 0;
  for (let i = 0; i < count; i++) m += (get(i) - m) / (i + 1);
  return m;
}

/** Mean and population variance (n divisor) in one pass. */
export function sampleMeanVar(vals: ArrayLike<number>): { mean: number; variance: number } {
  const n = vals.length;
  let m = 0, m2 = 0;
  for (let i = 0; i < n; i++) {
    const x = vals[i];
    const d = x - m;
    m += d / (i + 1);
    m2 += d * (x - m);
  }
  return { mean: m, variance: n > 0 ? m2 / n : NaN };
}
