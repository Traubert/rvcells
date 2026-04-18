import { describe, it, expect } from "vitest";
import {
  createSheet,
  setCellRaw,
  recalculateAllBulk,
  collectInputs,
  collectAllStochasticNodes,
  findMergeCandidates,
  computeSobolFirstOrder,
  computeRegressionSensitivity,
  DEFAULT_SETTINGS,
} from "./evaluate";
import type { Sheet, WorkbookSettings } from "./types";

function settings(numSamples: number): WorkbookSettings {
  return { ...DEFAULT_SETTINGS, numSamples };
}

function makeSheet(cells: Record<string, string>, numSamples = 2_000): Sheet {
  const sheet = createSheet();
  const s = settings(numSamples);
  for (const [addr, raw] of Object.entries(cells)) {
    setCellRaw(sheet, addr, raw, undefined, undefined, s);
  }
  return sheet;
}

describe("collectAllStochasticNodes", () => {
  it("returns leaves and intermediates", () => {
    const sheet = makeSheet({
      A1: "Normal(10, 1)",
      A2: "Normal(20, 2)",
      A3: "Normal(30, 3)",
      B1: "= A1 + A2",  // intermediate
      B2: "= B1 + A3",  // output
    });
    const nodes = collectAllStochasticNodes("B2", 0, [sheet]);
    const labels = nodes.map(n => n.label).sort();
    // Should include leaves A1, A2, A3 AND intermediate B1
    expect(labels).toContain("A1");
    expect(labels).toContain("A2");
    expect(labels).toContain("A3");
    expect(labels).toContain("B1");
    expect(labels).not.toContain("B2"); // output itself excluded
  });
});

describe("findMergeCandidates", () => {
  it("offers a merge when leaves only feed the output via an intermediate", () => {
    // total = subtotal + apirate; subtotal = D1 + D2 + D3; apirate is independent
    const sheet = makeSheet({
      D1: "Normal(10, 1)",
      D2: "Normal(10, 1)",
      D3: "Normal(10, 1)",
      A1: "subtotal := D1 + D2 + D3",
      A2: "apirate := Normal(5, 1)",
      A3: "total := subtotal + apirate",
    });
    const inputs = collectInputs("A3", 0, [sheet]);
    const candidates = findMergeCandidates("A3", 0, [sheet], inputs);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const subtotalCandidate = candidates.find(c => c.target.label === "subtotal");
    expect(subtotalCandidate).toBeDefined();
    const mergedAddrs = subtotalCandidate!.mergedLeaves.map(l => l.addr).sort();
    expect(mergedAddrs).toEqual(["D1", "D2", "D3"]);
  });

  it("rejects merges that would double-count when a leaf has another path", () => {
    // total uses D1 directly AND through subtotal — merging subtotal would hide D1's direct path
    const sheet = makeSheet({
      D1: "Normal(10, 1)",
      D2: "Normal(10, 1)",
      A1: "subtotal := D1 + D2",
      A2: "total := subtotal + D1",
    });
    const inputs = collectInputs("A2", 0, [sheet]);
    const candidates = findMergeCandidates("A2", 0, [sheet], inputs);
    expect(candidates.find(c => c.target.label === "subtotal")).toBeUndefined();
  });

  it("allows downstream cells to depend on the intermediate", () => {
    // contingency = subtotal * 0.1; total = subtotal + contingency
    // Even though subtotal feeds both contingency and total, both go *through* subtotal —
    // the leaves D1, D2 are only used by subtotal, so the merge is safe.
    const sheet = makeSheet({
      D1: "Normal(10, 1)",
      D2: "Normal(20, 2)",
      A1: "subtotal := D1 + D2",
      A2: "contingency := subtotal * 0.1",
      A3: "total := subtotal + contingency",
    });
    const inputs = collectInputs("A3", 0, [sheet]);
    const candidates = findMergeCandidates("A3", 0, [sheet], inputs);
    const subtotalCandidate = candidates.find(c => c.target.label === "subtotal");
    expect(subtotalCandidate).toBeDefined();
    expect(subtotalCandidate!.mergedLeaves.map(l => l.addr).sort()).toEqual(["D1", "D2"]);
  });
});

describe("collectInputs with stop set", () => {
  it("treats merged intermediate as an input and skips its leaves", () => {
    const sheet = makeSheet({
      D1: "Normal(10, 1)",
      D2: "Normal(20, 2)",
      A1: "subtotal := D1 + D2",
      A2: "apirate := Normal(5, 1)",
      A3: "total := subtotal + apirate",
    });
    const stopSet = new Set<string>(["0:A1"]); // GA for subtotal
    const inputs = collectInputs("A3", 0, [sheet], stopSet);
    const labels = inputs.map(i => i.label).sort();
    expect(labels).toContain("subtotal");
    expect(labels).toContain("apirate");
    expect(labels).not.toContain("D1");
    expect(labels).not.toContain("D2");
  });
});

describe("computeSobolFirstOrder", () => {
  it("returns ~1 when Y is a deterministic function of X", () => {
    const n = 2000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.random();
      y[i] = 2 * x[i] + 3;
    }
    const s1 = computeSobolFirstOrder(x, y);
    expect(s1).toBeGreaterThan(0.9);
  });

  it("returns ~0 when Y is independent of X", () => {
    const n = 2000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.random();
      y[i] = Math.random();
    }
    const s1 = computeSobolFirstOrder(x, y);
    expect(s1).toBeLessThan(0.1);
  });

  it("recovers a known partial dependency", () => {
    // Y = 0.7 * X1 + 0.3 * X2 (X1, X2 independent uniforms)
    // Sobol S1 for X1 should be ≈ 0.7² / (0.7² + 0.3²) ≈ 0.845
    const n = 5000;
    const x1 = new Float64Array(n);
    const x2 = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x1[i] = Math.random();
      x2[i] = Math.random();
      y[i] = 0.7 * x1[i] + 0.3 * x2[i];
    }
    const s1_x1 = computeSobolFirstOrder(x1, y);
    const s1_x2 = computeSobolFirstOrder(x2, y);
    expect(s1_x1).toBeGreaterThan(0.7);
    expect(s1_x1).toBeLessThan(0.95);
    expect(s1_x2).toBeGreaterThan(0.05);
    expect(s1_x2).toBeLessThan(0.25);
  });
});

describe("computeRegressionSensitivity", () => {
  it("recovers regression coefficients on independent inputs", () => {
    // Y = 2 X1 + 3 X2 + small noise, X1, X2 independent
    const n = 2000;
    const x1 = new Float64Array(n);
    const x2 = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x1[i] = Math.random();
      x2[i] = Math.random();
      y[i] = 2 * x1[i] + 3 * x2[i] + (Math.random() - 0.5) * 0.01;
    }
    const result = computeRegressionSensitivity([x1, x2], y);
    expect(result.collinear).toBe(false);
    expect(result.totalR2).toBeGreaterThan(0.99);
    // Standardised betas: positive
    expect(result.stdBetas[0]).toBeGreaterThan(0);
    expect(result.stdBetas[1]).toBeGreaterThan(0);
    // X2 has the larger coefficient → larger std β
    expect(result.stdBetas[1]).toBeGreaterThan(result.stdBetas[0]);
    // Partial r² should sum approximately to total R² when inputs are uncorrelated
    const sumPartial = result.partialR2[0] + result.partialR2[1];
    expect(sumPartial).toBeGreaterThan(0.9);
  });

  it("discounts redundant predictors via partial r²", () => {
    // X2 is mostly a copy of X1 → it should have small partial r² even though both correlate with Y
    const n = 2000;
    const x1 = new Float64Array(n);
    const x2 = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x1[i] = Math.random();
      x2[i] = x1[i] + (Math.random() - 0.5) * 0.01; // near-copy
      y[i] = x1[i] + (Math.random() - 0.5) * 0.05;
    }
    const result = computeRegressionSensitivity([x1, x2], y);
    // Both correlated with Y, but x2 adds nothing new beyond x1, so its partial r² is tiny
    // and the unique x1 contribution + shared overlap should dominate
    expect(result.partialR2[1]).toBeLessThan(0.1);
    // totalR² is high
    expect(result.totalR2).toBeGreaterThan(0.7);
  });

  it("flags collinear inputs", () => {
    // X2 is exactly X1 — singular design matrix
    const n = 500;
    const x1 = new Float64Array(n);
    const x2 = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x1[i] = Math.random();
      x2[i] = x1[i];
      y[i] = x1[i];
    }
    const result = computeRegressionSensitivity([x1, x2], y);
    expect(result.collinear).toBe(true);
  });

  it("handles a single input", () => {
    const n = 1000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = Math.random();
      y[i] = 5 * x[i];
    }
    const result = computeRegressionSensitivity([x], y);
    expect(result.collinear).toBe(false);
    expect(result.totalR2).toBeGreaterThan(0.99);
    expect(result.partialR2[0]).toBeGreaterThan(0.99);
    expect(result.stdBetas[0]).toBeGreaterThan(0.99);
  });
});

// Sanity check: confirm recalculateAllBulk runs cleanly so the project-cost-style
// fixture used in the merge candidate tests has well-formed sample arrays.
describe("integration sanity", () => {
  it("project-cost fixture has well-formed results after recalc", () => {
    const sheet = makeSheet({
      D1: "Normal(100, 10)",
      D2: "Normal(50, 5)",
      A1: "subtotal := D1 + D2",
      A2: "contingency := subtotal * 0.10",
      A3: "total := subtotal + contingency",
    }, 1000);
    recalculateAllBulk([sheet], settings(1000));
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    expect(sheet.cells.get("A3")?.result?.kind).toBe("samples");
  });
});
