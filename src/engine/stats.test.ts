import { describe, it, expect } from "vitest";
import { sampleMean, sampleMeanBy, sampleMeanVar } from "./stats";
import { summarize } from "./evaluate";

describe("Welford sample statistics", () => {
  it("is bit-exact on a constant non-integer array", () => {
    // 579000 + (30407 + 76369) + (0 + 466.52 + 0 + 67.16 + 14000): naive Σx/n
    // over 10k copies gives mean 700309.6800000721 and std 7.2e-8 ("72.1n").
    const v = 700309.68;
    const arr = new Float64Array(10_000).fill(v);
    expect(sampleMean(arr)).toBe(v);
    const { mean, variance } = sampleMeanVar(arr);
    expect(mean).toBe(v);
    expect(variance).toBe(0);
    const s = summarize({ kind: "samples", values: arr });
    expect(s.mean).toBe(v);
    expect(s.std).toBe(0);
  });

  it("stays exact for many random constants", () => {
    let seed = 1;
    for (let k = 0; k < 500; k++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = seed / 1e3 + 0.123456789 * (seed % 97);
      const arr = new Float64Array(10_000).fill(v);
      const { mean, variance } = sampleMeanVar(arr);
      expect(mean).toBe(v);
      expect(variance).toBe(0);
    }
  });

  it("matches the exact mean and population variance on small integer data", () => {
    const arr = new Float64Array([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(sampleMean(arr)).toBe(5);
    const { mean, variance } = sampleMeanVar(arr);
    expect(mean).toBe(5);
    expect(variance).toBe(4);
  });

  it("supports sub-ranges and index mapping", () => {
    const arr = new Float64Array([100, 1, 2, 3, 100]);
    expect(sampleMean(arr, 1, 4)).toBe(2);
    expect(sampleMeanBy(3, i => arr[i + 1] * 2)).toBe(4);
  });

  it("returns NaN variance for an empty array", () => {
    expect(sampleMeanVar(new Float64Array(0)).variance).toBeNaN();
  });
});
