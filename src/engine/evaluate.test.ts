import { describe, it, expect } from "vitest";
import { createSheet, setCellRaw, summarize, recalculateBulk, recalculateAllBulk, renameSheet, findRefsToSheet, collectInputs, spearmanCorrelation, histogram, DEFAULT_SETTINGS } from "./evaluate";
import type { Sheet, WorkbookSettings } from "./types";
import { parseCell } from "./parser";

function settingsWithSamples(numSamples: number): WorkbookSettings {
  return { ...DEFAULT_SETTINGS, numSamples };
}

/** Helper: create a sheet and set multiple cells */
function makeSheet(cells: Record<string, string>, numSamples = 1_000): Sheet {
  const sheet = createSheet();
  const settings = settingsWithSamples(numSamples);
  for (const [addr, raw] of Object.entries(cells)) {
    setCellRaw(sheet, addr, raw, undefined, undefined, settings);
  }
  return sheet;
}

/** Helper: get the mean of a cell's result */
function mean(sheet: Sheet, addr: string): number {
  const cell = sheet.cells.get(addr);
  if (!cell?.result) throw new Error(`No result for ${addr}`);
  return summarize(cell.result).mean;
}

/** Helper: get the std of a cell's result */
function std(sheet: Sheet, addr: string): number {
  const cell = sheet.cells.get(addr);
  if (!cell?.result) throw new Error(`No result for ${addr}`);
  return summarize(cell.result).std;
}

/** Helper: check if a cell's result is scalar */
function isScalar(sheet: Sheet, addr: string): boolean {
  return sheet.cells.get(addr)?.result?.kind === "scalar";
}

/** Helper: get scalar value */
function scalarValue(sheet: Sheet, addr: string): number {
  const cell = sheet.cells.get(addr);
  if (!cell?.result || cell.result.kind !== "scalar") throw new Error(`${addr} is not scalar`);
  return cell.result.value;
}

describe("basic cell types", () => {
  it("evaluates a number as scalar", () => {
    const sheet = makeSheet({ A1: "42" });
    expect(isScalar(sheet, "A1")).toBe(true);
    expect(scalarValue(sheet, "A1")).toBe(42);
  });

  it("evaluates a negative number as scalar", () => {
    const sheet = makeSheet({ A1: "-7" });
    expect(scalarValue(sheet, "A1")).toBe(-7);
  });

  it("text cells have no result", () => {
    const sheet = makeSheet({ A1: "hello" });
    expect(sheet.cells.get("A1")?.result).toBeUndefined();
  });

  it("empty cells are removed", () => {
    const sheet = makeSheet({ A1: "42" });
    setCellRaw(sheet, "A1", "");
    expect(sheet.cells.has("A1")).toBe(false);
  });

  it("evaluates a distribution as samples", () => {
    const sheet = makeSheet({ A1: "Normal(100, 10)" });
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    const stats = summarize(sheet.cells.get("A1")!.result!);
    expect(stats.mean).toBeCloseTo(100, -1);
    expect(stats.std).toBeCloseTo(10, 0);
  });
});

describe("scalar arithmetic", () => {
  it("adds two scalars", () => {
    const sheet = makeSheet({ A1: "10", B1: "20", C1: "= A1 + B1" });
    expect(isScalar(sheet, "C1")).toBe(true);
    expect(scalarValue(sheet, "C1")).toBe(30);
  });

  it("subtracts scalars", () => {
    const sheet = makeSheet({ A1: "50", B1: "30", C1: "= A1 - B1" });
    expect(scalarValue(sheet, "C1")).toBe(20);
  });

  it("multiplies scalars", () => {
    const sheet = makeSheet({ A1: "6", B1: "7", C1: "= A1 * B1" });
    expect(scalarValue(sheet, "C1")).toBe(42);
  });

  it("divides scalars", () => {
    const sheet = makeSheet({ A1: "100", B1: "4", C1: "= A1 / B1" });
    expect(scalarValue(sheet, "C1")).toBe(25);
  });

  it("respects operator precedence", () => {
    const sheet = makeSheet({ A1: "2", B1: "3", C1: "5", D1: "= A1 + B1 * C1" });
    expect(scalarValue(sheet, "D1")).toBe(17); // 2 + 15, not 25
  });

  it("respects parentheses", () => {
    const sheet = makeSheet({ A1: "2", B1: "3", C1: "5", D1: "= (A1 + B1) * C1" });
    expect(scalarValue(sheet, "D1")).toBe(25);
  });

  it("handles unary minus", () => {
    const sheet = makeSheet({ A1: "10", B1: "= -A1" });
    expect(scalarValue(sheet, "B1")).toBe(-10);
  });

  it("chains formulas through multiple cells", () => {
    const sheet = makeSheet({
      A1: "10",
      B1: "= A1 * 2",
      C1: "= B1 + 5",
      D1: "= C1 / 5",
    });
    expect(scalarValue(sheet, "B1")).toBe(20);
    expect(scalarValue(sheet, "C1")).toBe(25);
    expect(scalarValue(sheet, "D1")).toBe(5);
  });

  it("referencing an empty cell gives 0", () => {
    const sheet = makeSheet({ B1: "= A1 + 1" });
    expect(scalarValue(sheet, "B1")).toBe(1);
  });
});

describe("distribution arithmetic", () => {
  it("adding a scalar to a distribution produces samples", () => {
    const sheet = makeSheet({ A1: "Normal(100, 10)", B1: "50", C1: "= A1 + B1" });
    expect(sheet.cells.get("C1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "C1")).toBeCloseTo(150, -1);
  });

  it("multiplying two distributions produces samples", () => {
    const sheet = makeSheet({ A1: "Uniform(2, 4)", B1: "Uniform(10, 20)", C1: "= A1 * B1" });
    expect(sheet.cells.get("C1")?.result?.kind).toBe("samples");
    // mean of Uniform(2,4) * Uniform(10,20) ≈ 3 * 15 = 45
    expect(mean(sheet, "C1")).toBeCloseTo(45, -1);
  });

  it("scalar-only formulas stay scalar even when other cells have distributions", () => {
    const sheet = makeSheet({ A1: "Normal(0, 1)", B1: "10", C1: "20", D1: "= B1 + C1" });
    expect(isScalar(sheet, "D1")).toBe(true);
    expect(scalarValue(sheet, "D1")).toBe(30);
  });

  it("distribution constructors work in formulas", () => {
    const sheet = makeSheet({ A1: "= Normal(100, 10) + 50" });
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "A1")).toBeCloseTo(150, -1);
  });
});

describe("built-in functions", () => {
  it("abs of negative scalar", () => {
    const sheet = makeSheet({ A1: "-5", B1: "= abs(A1)" });
    expect(scalarValue(sheet, "B1")).toBe(5);
  });

  it("sqrt of scalar", () => {
    const sheet = makeSheet({ A1: "9", B1: "= sqrt(A1)" });
    expect(scalarValue(sheet, "B1")).toBe(3);
  });

  it("max of two scalars", () => {
    const sheet = makeSheet({ A1: "3", B1: "7", C1: "= max(A1, B1)" });
    expect(scalarValue(sheet, "C1")).toBe(7);
  });

  it("min of two scalars", () => {
    const sheet = makeSheet({ A1: "3", B1: "7", C1: "= min(A1, B1)" });
    expect(scalarValue(sheet, "C1")).toBe(3);
  });

  it("clamp", () => {
    const sheet = makeSheet({ A1: "15", B1: "= clamp(A1, 0, 10)" });
    expect(scalarValue(sheet, "B1")).toBe(10);
  });

  it("if with positive condition", () => {
    const sheet = makeSheet({ A1: "1", B1: "= if(A1, 10, 20)" });
    expect(scalarValue(sheet, "B1")).toBe(10);
  });

  it("if with non-positive condition", () => {
    const sheet = makeSheet({ A1: "0", B1: "= if(A1, 10, 20)" });
    expect(scalarValue(sheet, "B1")).toBe(20);
  });

  it("functions work elementwise on distributions", () => {
    const sheet = makeSheet({ A1: "Normal(100, 10)", B1: "= abs(A1)" });
    expect(sheet.cells.get("B1")?.result?.kind).toBe("samples");
    // abs of Normal(100,10) should have mean close to 100 (rarely negative)
    expect(mean(sheet, "B1")).toBeCloseTo(100, -1);
  });

  it("pow", () => {
    const sheet = makeSheet({ A1: "3", B1: "= pow(A1, 2)" });
    expect(scalarValue(sheet, "B1")).toBe(9);
  });

  it("exp and log are inverses", () => {
    const sheet = makeSheet({ A1: "5", B1: "= log(exp(A1))" });
    expect(scalarValue(sheet, "B1")).toBeCloseTo(5, 10);
  });

  it("floor and ceil", () => {
    const sheet = makeSheet({ A1: "3.7", B1: "= floor(A1)", C1: "= ceil(A1)" });
    expect(scalarValue(sheet, "B1")).toBe(3);
    expect(scalarValue(sheet, "C1")).toBe(4);
  });

  it("round", () => {
    const sheet = makeSheet({ A1: "3.5", B1: "= round(A1)" });
    expect(scalarValue(sheet, "B1")).toBe(4);
  });
});

describe("variables", () => {
  it("defines and references a variable", () => {
    const sheet = makeSheet({
      A1: "income = 5000",
      B1: "= income * 12",
    });
    expect(scalarValue(sheet, "A1")).toBe(5000);
    expect(scalarValue(sheet, "B1")).toBe(60000);
  });

  it("variable names are case-insensitive", () => {
    const sheet = makeSheet({
      A1: "Income = 5000",
      B1: "= income * 2",
    });
    expect(scalarValue(sheet, "B1")).toBe(10000);
  });

  it("variable with distribution", () => {
    const sheet = makeSheet({
      A1: "salary = Normal(5000, 500)",
      B1: "= salary * 12",
    });
    expect(sheet.cells.get("B1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "B1")).toBeCloseTo(60000, -3);
  });

  it("variable with formula", () => {
    const sheet = makeSheet({
      A1: "100",
      B1: "tax = A1 * 0.3",
      C1: "= tax",
    });
    expect(scalarValue(sheet, "C1")).toBe(30);
  });

  it("unknown variable produces error", () => {
    const sheet = makeSheet({ A1: "= unknown_var + 1" });
    expect(sheet.cells.get("A1")?.error).toMatch(/unknown variable/i);
  });

  it("duplicate variable name at edit time is an error", () => {
    const sheet = makeSheet({ A1: "x = 10" });
    const cell = setCellRaw(sheet, "B1", "x = 20");
    expect(cell?.error).toMatch(/duplicate variable/i);
    // Original keeps its value
    expect(scalarValue(sheet, "A1")).toBe(10);
  });

  it("duplicate variable does not overwrite original in formulas", () => {
    const sheet = makeSheet({
      A1: "x = 10",
      C1: "= x + 1",
    });
    setCellRaw(sheet, "B1", "x = 99");
    // C1 should still use A1's definition
    expect(scalarValue(sheet, "C1")).toBe(11);
  });

  it("removing original variable clears duplicate error", () => {
    const sheet = makeSheet({ A1: "x = 10" });
    setCellRaw(sheet, "B1", "x = 20");
    expect(sheet.cells.get("B1")?.error).toMatch(/duplicate/i);
    // Remove the original
    setCellRaw(sheet, "A1", "");
    // B1 should now be valid
    expect(sheet.cells.get("B1")?.error).toBeFalsy();
    expect(scalarValue(sheet, "B1")).toBe(20);
  });
});

describe("label variables (:=)", () => {
  it("derives variable name from text cell to the left", () => {
    const sheet = makeSheet({
      A1: "Income",
      B1: ":= 5000",
    });
    expect(sheet.cells.get("B1")?.variableName).toBe("income");
    expect(scalarValue(sheet, "B1")).toBe(5000);
  });

  it("label variable is usable in formulas", () => {
    const sheet = makeSheet({
      A1: "Income",
      B1: ":= 5000",
      C1: "= income * 12",
    });
    expect(scalarValue(sheet, "C1")).toBe(60000);
  });

  it("updates variable name when label text changes", () => {
    const sheet = makeSheet({
      A1: "Income",
      B1: ":= 5000",
      C1: "= income * 2",
    });
    expect(scalarValue(sheet, "C1")).toBe(10000);

    // Change the label
    setCellRaw(sheet, "A1", "Salary");
    expect(sheet.cells.get("B1")?.variableName).toBe("salary");
    // Old variable name no longer works — C1 should error
    expect(sheet.cells.get("C1")?.error).toBeTruthy();
  });

  it("label variable with distribution", () => {
    const sheet = makeSheet({
      A1: "Revenue",
      B1: ":= Normal(1000, 100)",
    });
    expect(sheet.cells.get("B1")?.variableName).toBe("revenue");
    expect(sheet.cells.get("B1")?.result?.kind).toBe("samples");
  });

  it("no variable name when left cell is not text", () => {
    const sheet = makeSheet({
      A1: "42",
      B1: ":= 5000",
    });
    expect(sheet.cells.get("B1")?.variableName).toBeUndefined();
  });

  it("no variable name when in column A", () => {
    const sheet = makeSheet({
      A1: ":= 5000",
    });
    expect(sheet.cells.get("A1")?.variableName).toBeUndefined();
  });

  it("handles multi-word labels with spaces", () => {
    const sheet = makeSheet({
      A1: "Tax Rate",
      B1: ":= 0.3",
    });
    expect(sheet.cells.get("B1")?.variableName).toBe("tax_rate");
  });

  it("clearing the label removes the variable name", () => {
    const sheet = makeSheet({
      A1: "Income",
      B1: ":= 5000",
    });
    expect(sheet.cells.get("B1")?.variableName).toBe("income");
    setCellRaw(sheet, "A1", "");
    expect(sheet.cells.get("B1")?.variableName).toBeUndefined();
  });

  it("duplicate label variable is an error", () => {
    const sheet = makeSheet({
      A1: "Cost",
      B1: ":= 100",
    });
    // Now add another label var with the same resolved name
    setCellRaw(sheet, "A2", "Cost");
    setCellRaw(sheet, "B2", ":= 200");
    expect(sheet.cells.get("B2")?.error).toMatch(/duplicate variable/i);
    expect(scalarValue(sheet, "B1")).toBe(100);
  });
});

describe("duplicate variables in bulk load", () => {
  it("first definition wins, second gets error", () => {
    const sheet = createSheet();
    // Manually set cells and use recalculateBulk (simulates file load)
    const cell1 = parseCell("x = 10");
    sheet.cells.set("A1", { raw: "x = 10", ...cell1 });
    const cell2 = parseCell("x = 20");
    sheet.cells.set("B1", { raw: "x = 20", ...cell2 });
    const cell3 = parseCell("= x + 1");
    sheet.cells.set("C1", { raw: "= x + 1", ...cell3 });
    recalculateBulk(sheet);

    // First definition (A1) wins
    expect(sheet.cells.get("A1")?.error).toBeFalsy();
    expect(sheet.cells.get("A1")?.result).toBeTruthy();
    // Second definition (B1) gets duplicate error
    expect(sheet.cells.get("B1")?.error).toMatch(/duplicate variable/i);
    // Formula uses the first definition
    const c1 = sheet.cells.get("C1")!;
    expect(c1.error).toBeFalsy();
    expect(c1.result?.kind).toBe("scalar");
    if (c1.result?.kind === "scalar") expect(c1.result.value).toBe(11);
  });
});

describe("incremental recalculation", () => {
  it("editing a cell updates its dependents", () => {
    const sheet = makeSheet({
      A1: "10",
      B1: "= A1 * 2",
    });
    expect(scalarValue(sheet, "B1")).toBe(20);
    setCellRaw(sheet, "A1", "20");
    expect(scalarValue(sheet, "B1")).toBe(40);
  });

  it("does not resample unrelated distribution cells", () => {
    const sheet = makeSheet({
      A1: "Normal(100, 10)",
      B1: "42",
    });
    const samplesBefore = sheet.cells.get("A1")!.result!;
    expect(samplesBefore.kind).toBe("samples");

    // Edit B1 — A1 should keep same samples
    setCellRaw(sheet, "B1", "43");
    const samplesAfter = sheet.cells.get("A1")!.result!;
    expect(samplesAfter).toBe(samplesBefore); // same object reference
  });

  it("propagates changes through a chain", () => {
    const sheet = makeSheet({
      A1: "10",
      B1: "= A1 + 1",
      C1: "= B1 + 1",
      D1: "= C1 + 1",
    });
    expect(scalarValue(sheet, "D1")).toBe(13);
    setCellRaw(sheet, "A1", "100");
    expect(scalarValue(sheet, "D1")).toBe(103);
  });
});

describe("cycle detection", () => {
  it("detects simple self-reference", () => {
    const sheet = makeSheet({ A1: "= A1 + 1" });
    expect(sheet.cells.get("A1")?.error).toMatch(/circular/i);
  });

  it("detects two-cell cycle", () => {
    const sheet = createSheet();
    setCellRaw(sheet, "A1", "= B1");
    setCellRaw(sheet, "B1", "= A1");
    // The second edit should be rejected
    expect(sheet.cells.get("B1")?.error).toMatch(/circular/i);
  });

  it("allows overwriting a cell that would remove a cycle", () => {
    const sheet = createSheet();
    setCellRaw(sheet, "A1", "10");
    setCellRaw(sheet, "B1", "= A1");
    // Try to make A1 depend on B1 — should fail
    setCellRaw(sheet, "A1", "= B1");
    expect(sheet.cells.get("A1")?.error).toMatch(/circular/i);
    // Fix it by making A1 a plain value again
    setCellRaw(sheet, "A1", "20");
    expect(sheet.cells.get("A1")?.error).toBeUndefined();
    expect(scalarValue(sheet, "B1")).toBe(20);
  });
});

describe("bulk recalculation with cycles", () => {
  it("marks cycle cells with errors and evaluates the rest", () => {
    const sheet = createSheet();
    // Manually set up cells that form a cycle
    const { content: c1 } = parseCell("= B1");
    const { content: c2 } = parseCell("= A1");
    const { content: c3 } = parseCell("42");
    sheet.cells.set("A1", { raw: "= B1", content: c1 });
    sheet.cells.set("B1", { raw: "= A1", content: c2 });
    sheet.cells.set("C1", { raw: "42", content: c3 });

    recalculateBulk(sheet);

    expect(sheet.cells.get("A1")?.error).toMatch(/circular/i);
    expect(sheet.cells.get("B1")?.error).toMatch(/circular/i);
    // C1 is not part of the cycle, should evaluate fine
    expect(sheet.cells.get("C1")?.error).toBeUndefined();
    expect(scalarValue(sheet, "C1")).toBe(42);
  });

  it("marks cells depending on a cycle as errors too", () => {
    const sheet = createSheet();
    const { content: c1 } = parseCell("= B1");
    const { content: c2 } = parseCell("= A1");
    const { content: c3 } = parseCell("= A1 + 1");
    sheet.cells.set("A1", { raw: "= B1", content: c1 });
    sheet.cells.set("B1", { raw: "= A1", content: c2 });
    sheet.cells.set("C1", { raw: "= A1 + 1", content: c3 });

    recalculateBulk(sheet);

    expect(sheet.cells.get("C1")?.error).toMatch(/circular/i);
  });
});

describe("bernoulli and discrete", () => {
  it("bernoulli produces samples of 0 and 1 with correct mean", () => {
    const sheet = makeSheet({ A1: "= Bernoulli(0.7)" }, 5000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "A1")).toBeCloseTo(0.7, 1);
  });

  it("bernoulli(0) produces all zeros", () => {
    const sheet = makeSheet({ A1: "= Bernoulli(0)" }, 1000);
    expect(mean(sheet, "A1")).toBe(0);
  });

  it("bernoulli(1) produces all ones", () => {
    const sheet = makeSheet({ A1: "= Bernoulli(1)" }, 1000);
    expect(mean(sheet, "A1")).toBe(1);
  });

  it("discrete produces correct distribution", () => {
    const sheet = makeSheet({ A1: "= Discrete(0.5, 0.3, 0.2)" }, 10000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    // Mean should be 0*0.5 + 1*0.3 + 2*0.2 = 0.7
    expect(mean(sheet, "A1")).toBeCloseTo(0.7, 1);
  });

  it("bernoulli works elementwise with if for Markov chains", () => {
    // Two-state Markov chain: state 1 has 90% stay prob, state 0 has 50% transition to 1
    const sheet = makeSheet({
      A1: "1",  // initial state: all employed
      A2: "= if(A1, Bernoulli(0.9), Bernoulli(0.5))",
      A3: "= if(A2, Bernoulli(0.9), Bernoulli(0.5))",
      A4: "= if(A3, Bernoulli(0.9), Bernoulli(0.5))",
    }, 10000);
    // After several steps, mean should be between 0 and 1
    // Stationary distribution: p = 0.5/(0.1+0.5) = 5/6 ≈ 0.833
    const m = mean(sheet, "A4");
    expect(m).toBeGreaterThan(0.7);
    expect(m).toBeLessThan(0.95);
  });
});

describe("pareto, poisson, studentt", () => {
  it("pareto produces samples >= xMin with correct mean", () => {
    const sheet = makeSheet({ A1: "= Pareto(1, 3)" }, 10000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    // E[X] = alpha * xMin / (alpha - 1) = 3 * 1 / 2 = 1.5
    expect(mean(sheet, "A1")).toBeCloseTo(1.5, 0);
    // All samples >= xMin
    const vals = (sheet.cells.get("A1")!.result as any).values as Float64Array;
    for (let i = 0; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(1);
  });

  it("pareto as cell-level distribution", () => {
    const sheet = makeSheet({ A1: "Pareto(2, 4)" }, 5000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    // E[X] = 4 * 2 / 3 ≈ 2.667
    expect(mean(sheet, "A1")).toBeCloseTo(2.667, 0);
  });

  it("poisson produces non-negative integers with correct mean", () => {
    const sheet = makeSheet({ A1: "= Poisson(7)" }, 10000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "A1")).toBeCloseTo(7, 0);
    const vals = (sheet.cells.get("A1")!.result as any).values as Float64Array;
    for (let i = 0; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(0);
      expect(vals[i] % 1).toBe(0); // integer
    }
  });

  it("poisson large lambda uses normal approximation", () => {
    const sheet = makeSheet({ A1: "= Poisson(50)" }, 10000);
    expect(mean(sheet, "A1")).toBeCloseTo(50, 0);
  });

  it("poisson as cell-level distribution", () => {
    const sheet = makeSheet({ A1: "Poisson(3)" }, 5000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "A1")).toBeCloseTo(3, 0);
  });

  it("studentt with 1 arg has mean ~0", () => {
    const sheet = makeSheet({ A1: "= StudentT(10)" }, 10000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "A1")).toBeCloseTo(0, 0);
  });

  it("studentt with location-scale", () => {
    const sheet = makeSheet({ A1: "= StudentT(10, 100, 15)" }, 10000);
    expect(mean(sheet, "A1")).toBeCloseTo(100, -1); // heavier tails → more sample mean variance
    expect(std(sheet, "A1")).toBeGreaterThan(10);
  });

  it("studentt as cell-level distribution", () => {
    const sheet = makeSheet({ A1: "StudentT(5)" }, 5000);
    expect(sheet.cells.get("A1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "A1")).toBeCloseTo(0, 0);
  });

  it("studentt cell-level with 3 args", () => {
    const sheet = makeSheet({ A1: "StudentT(4, 50, 10)" }, 5000);
    expect(mean(sheet, "A1")).toBeCloseTo(50, 0);
  });
});

describe("resample", () => {
  it("resample produces samples with same distribution but different draws", () => {
    const sheet = makeSheet({
      A1: "Normal(100, 10)",
      B1: "= resample(A1)",
    }, 5000);
    expect(sheet.cells.get("B1")?.result?.kind).toBe("samples");
    // Same distribution parameters
    expect(mean(sheet, "B1")).toBeCloseTo(100, -1);
    expect(std(sheet, "B1")).toBeCloseTo(10, 0);
    // But different samples — check that they're not the same array
    const a = sheet.cells.get("A1")!.result! as { kind: "samples"; values: Float64Array };
    const b = sheet.cells.get("B1")!.result! as { kind: "samples"; values: Float64Array };
    expect(a.values).not.toBe(b.values);
    // Correlation should be near zero (independent draws)
    let sumAB = 0, sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0;
    const n = a.values.length;
    for (let i = 0; i < n; i++) {
      sumA += a.values[i]; sumB += b.values[i];
      sumA2 += a.values[i] ** 2; sumB2 += b.values[i] ** 2;
      sumAB += a.values[i] * b.values[i];
    }
    const corr = (sumAB / n - (sumA / n) * (sumB / n)) /
      (Math.sqrt(sumA2 / n - (sumA / n) ** 2) * Math.sqrt(sumB2 / n - (sumB / n) ** 2));
    expect(Math.abs(corr)).toBeLessThan(0.05);
  });

  it("resample re-evaluates the entire sub-DAG", () => {
    const sheet = makeSheet({
      A1: "Normal(0, 1)",
      B1: "= A1 * 10 + 50",  // derived distribution: mean 50, std 10
      C1: "= resample(B1)",
    }, 5000);
    expect(mean(sheet, "C1")).toBeCloseTo(50, -1);
    expect(std(sheet, "C1")).toBeCloseTo(10, 0);
  });

  it("resample of a scalar returns the same scalar", () => {
    const sheet = makeSheet({
      A1: "42",
      B1: "= resample(A1)",
    });
    expect(isScalar(sheet, "B1")).toBe(true);
    expect(scalarValue(sheet, "B1")).toBe(42);
  });

  it("resample works with variable references", () => {
    const sheet = makeSheet({
      A1: "price = Normal(100, 10)",
      B1: "= resample(price)",
    }, 5000);
    expect(sheet.cells.get("B1")?.result?.kind).toBe("samples");
    expect(mean(sheet, "B1")).toBeCloseTo(100, -1);
  });

  it("multiple resamples of same cell are independent", () => {
    const sheet = makeSheet({
      A1: "Normal(0, 1)",
      B1: "= resample(A1)",
      C1: "= resample(A1)",
    }, 5000);
    const b = sheet.cells.get("B1")!.result! as { kind: "samples"; values: Float64Array };
    const c = sheet.cells.get("C1")!.result! as { kind: "samples"; values: Float64Array };
    expect(b.values).not.toBe(c.values);
    // Check they're not identical
    let same = true;
    for (let i = 0; i < 10; i++) {
      if (b.values[i] !== c.values[i]) { same = false; break; }
    }
    expect(same).toBe(false);
  });
});

describe("cross-sheet references", () => {
  /** Helper: create multiple named sheets and set cells */
  function makeSheets(defs: { name: string; cells: Record<string, string> }[]): Sheet[] {
    const sheets = defs.map((d) => createSheet(d.name));
    // First set all cells without cross-sheet eval
    for (let si = 0; si < defs.length; si++) {
      for (const [addr, raw] of Object.entries(defs[si].cells)) {
        const { content, variableName, labelVar } = parseCell(raw);
        sheets[si].cells.set(addr, { raw, content, variableName, labelVar });
      }
    }
    recalculateAllBulk(sheets, settingsWithSamples(1_000));
    return sheets;
  }

  it("references a cell in another sheet by name", () => {
    const sheets = makeSheets([
      { name: "Data", cells: { A1: "42" } },
      { name: "Main", cells: { A1: "= Data.A1 + 1" } },
    ]);
    const cell = sheets[1].cells.get("A1")!;
    expect(cell.error).toBeFalsy();
    expect(cell.result?.kind).toBe("scalar");
    if (cell.result?.kind === "scalar") expect(cell.result.value).toBe(43);
  });

  it("references a variable in another sheet", () => {
    const sheets = makeSheets([
      { name: "Data", cells: { A1: "income = 5000" } },
      { name: "Main", cells: { A1: "= Data.income * 12" } },
    ]);
    const cell = sheets[1].cells.get("A1")!;
    expect(cell.error).toBeFalsy();
    expect(cell.result?.kind).toBe("scalar");
    if (cell.result?.kind === "scalar") expect(cell.result.value).toBe(60000);
  });

  it("errors on unknown sheet name", () => {
    const sheets = makeSheets([
      { name: "Main", cells: { A1: "= NoSuchSheet.A1" } },
    ]);
    expect(sheets[0].cells.get("A1")?.error).toMatch(/unknown sheet/i);
  });

  it("errors on unknown variable in target sheet", () => {
    const sheets = makeSheets([
      { name: "Data", cells: { A1: "42" } },
      { name: "Main", cells: { A1: "= Data.novar" } },
    ]);
    expect(sheets[1].cells.get("A1")?.error).toMatch(/unknown variable/i);
  });

  it("incremental recalc propagates across sheets", () => {
    const sheets = makeSheets([
      { name: "Data", cells: { A1: "10" } },
      { name: "Main", cells: { A1: "= Data.A1 * 2" } },
    ]);
    expect(sheets[1].cells.get("A1")?.result).toEqual({ kind: "scalar", value: 20 });
    // Edit cell in Data sheet
    setCellRaw(sheets[0], "A1", "25", sheets, 0);
    expect(sheets[1].cells.get("A1")?.result).toEqual({ kind: "scalar", value: 50 });
  });

  it("rename updates cross-sheet references", () => {
    const sheets = makeSheets([
      { name: "Data", cells: { A1: "100" } },
      { name: "Main", cells: { A1: "= Data.A1 + 1" } },
    ]);
    renameSheet(sheets, 0, "Inputs");
    // Raw should be updated
    expect(sheets[1].cells.get("A1")?.raw).toContain("Inputs");
    // Result should still work
    const cell = sheets[1].cells.get("A1")!;
    expect(cell.error).toBeFalsy();
    expect(cell.result).toEqual({ kind: "scalar", value: 101 });
  });

  it("findRefsToSheet finds cross-sheet references", () => {
    const sheets = makeSheets([
      { name: "Data", cells: { A1: "42" } },
      { name: "Main", cells: { A1: "= Data.A1", B1: "= A1 + 1" } },
    ]);
    const refs = findRefsToSheet(sheets, "Data");
    expect(refs.length).toBe(1);
    expect(refs[0]).toEqual({ sheetIndex: 1, addr: "A1" });
  });

  it("quoted sheet name works", () => {
    const sheets = makeSheets([
      { name: "My Data", cells: { A1: "99" } },
      { name: "Main", cells: { A1: "= 'My Data'.A1" } },
    ]);
    const cell = sheets[1].cells.get("A1")!;
    expect(cell.error).toBeFalsy();
    expect(cell.result).toEqual({ kind: "scalar", value: 99 });
  });
});

describe("sensitivity analysis", () => {
  it("spearman correlation of identical arrays is 1", () => {
    const a = new Float64Array([1, 2, 3, 4, 5]);
    expect(spearmanCorrelation(a, a)).toBeCloseTo(1, 5);
  });

  it("spearman correlation of reversed array is -1", () => {
    const a = new Float64Array([1, 2, 3, 4, 5]);
    const b = new Float64Array([5, 4, 3, 2, 1]);
    expect(spearmanCorrelation(a, b)).toBeCloseTo(-1, 5);
  });

  it("collectInputs finds distribution sources", () => {
    const sheet = makeSheet({
      A1: "Normal(100, 10)",
      A2: "Normal(50, 5)",
      A3: "= A1 + A2",
    });
    const inputs = collectInputs("A3", 0, [sheet]);
    expect(inputs.length).toBe(2);
    expect(inputs.map((i) => i.addr).sort()).toEqual(["A1", "A2"]);
    expect(inputs.every((i) => !i.isScalar)).toBe(true);
  });

  it("collectInputs includes scalars", () => {
    const sheet = makeSheet({
      A1: "1000",
      A2: "Normal(50, 5)",
      A3: "= A1 * A2",
    });
    const inputs = collectInputs("A3", 0, [sheet]);
    expect(inputs.length).toBe(2);
    const scalar = inputs.find((i) => i.addr === "A1");
    expect(scalar?.isScalar).toBe(true);
  });

  it("collectInputs labels variables", () => {
    const sheet = makeSheet({
      A1: "income = Normal(5000, 500)",
      A2: "= income * 12",
    });
    const inputs = collectInputs("A2", 0, [sheet]);
    expect(inputs.length).toBe(1);
    expect(inputs[0].label).toBe("income");
  });

  it("collectInputs skips intermediate formulas", () => {
    const sheet = makeSheet({
      A1: "Normal(100, 10)",
      A2: "Normal(50, 5)",
      A3: "= A1 + A2",       // intermediate
      A4: "= A3 * 2",        // output
    });
    const inputs = collectInputs("A4", 0, [sheet]);
    // Should find A1 and A2, not A3
    expect(inputs.map((i) => i.addr).sort()).toEqual(["A1", "A2"]);
  });
});

describe("summary statistics", () => {
  it("scalar has zero std and all percentiles equal", () => {
    const sheet = makeSheet({ A1: "42" });
    const stats = summarize(sheet.cells.get("A1")!.result!);
    expect(stats.mean).toBe(42);
    expect(stats.std).toBe(0);
    expect(stats.p5).toBe(42);
    expect(stats.p50).toBe(42);
    expect(stats.p95).toBe(42);
  });

  it("Normal distribution has expected percentile ordering", () => {
    const sheet = makeSheet({ A1: "Normal(100, 10)" });
    const stats = summarize(sheet.cells.get("A1")!.result!);
    expect(stats.p5).toBeLessThan(stats.p25);
    expect(stats.p25).toBeLessThan(stats.p50);
    expect(stats.p50).toBeLessThan(stats.p75);
    expect(stats.p75).toBeLessThan(stats.p95);
  });
});

describe("Chain", () => {
  it("scalar chain: x = Chain(x + 1, 0), x[5] → 5", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + 1, 0)",
      B1: "= x[5]",
    });
    // Direct reference to chain returns initial value
    expect(scalarValue(sheet, "A1")).toBe(0);
    // x[5] returns step 5: 0+1+1+1+1+1 = 5
    expect(mean(sheet, "B1")).toBeCloseTo(5, 5);
  });

  it("chain with distribution produces samples", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + Normal(0, 1), 0)",
      B1: "= x[10]",
    }, 10000);
    const cell = sheet.cells.get("B1")!;
    expect(cell.result?.kind).toBe("samples");
    // After 10 steps of adding N(0,1), mean ≈ 0, std ≈ sqrt(10)
    const stats = summarize(cell.result!);
    expect(stats.mean).toBeCloseTo(0, 0);
    expect(stats.std).toBeCloseTo(Math.sqrt(10), 0);
  });

  it("non-scalar initial value", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + 1, Normal(100, 10))",
      B1: "= x[0]",
      C1: "= x[3]",
    }, 10000);
    // Step 0 is the initial distribution
    const step0 = sheet.cells.get("B1")!;
    expect(step0.result?.kind).toBe("samples");
    expect(summarize(step0.result!).mean).toBeCloseTo(100, 0);
    // Step 3 adds 3 to each sample
    expect(summarize(sheet.cells.get("C1")!.result!).mean).toBeCloseTo(103, 0);
  });

  it("self-reference does not cause cycle error", () => {
    const sheet = makeSheet({ A1: "x = Chain(x * 2, 1)" });
    expect(sheet.cells.get("A1")!.error).toBeUndefined();
    expect(scalarValue(sheet, "A1")).toBe(1);
  });

  it("auto-resamples referenced distribution cells each step", () => {
    const sheet = makeSheet({
      A1: "ret = Normal(0, 1)",
      A2: "x = Chain(x + ret, 0)",
      B2: "= x[100]",
    }, 10000);
    const stats = summarize(sheet.cells.get("B2")!.result!);
    // After 100 steps of adding N(0,1), std ≈ sqrt(100) = 10
    // If NOT resampled, std would be ≈ 100 (same draw every step)
    expect(stats.std).toBeCloseTo(10, 0);
  });

  it("cross-chain auto-sync", () => {
    const sheet = makeSheet({
      A1: "a = Chain(a + 1, 0)",
      A2: "b = Chain(b + a, 0)",
      B2: "= b[3]",
    });
    // a at step 1=1, 2=2, 3=3
    // b at step 1=b0+a1=0+1=1, step 2=1+2=3, step 3=3+3=6
    expect(mean(sheet, "B2")).toBeCloseTo(6, 5);
  });

  it("_t variable gives current step number", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + _t, 0)",
      B1: "= x[3]",
    });
    // step 1: 0 + 1 = 1, step 2: 1 + 2 = 3, step 3: 3 + 3 = 6
    expect(mean(sheet, "B1")).toBeCloseTo(6, 5);
  });

  it("unknown variable in chain body is an error at input time", () => {
    const sheet = makeSheet({ A1: "foo = Chain(bar + 1, 0)" });
    expect(sheet.cells.get("A1")!.error).toContain("Unknown variable in Chain body: bar");
  });

  it("_t cannot be used as a variable name", () => {
    const sheet = makeSheet({ A1: "_t = 5" });
    expect(sheet.cells.get("A1")!.error).toContain("reserved");
  });

  it("cache invalidation on recalculate", () => {
    const sheet = makeSheet({
      A1: "init = 10",
      A2: "x = Chain(x + 1, init)",
      B2: "= x[5]",
    });
    expect(mean(sheet, "B2")).toBeCloseTo(15, 5);
    // Change initial value
    setCellRaw(sheet, "A1", "init = 20");
    expect(mean(sheet, "B2")).toBeCloseTo(25, 5);
  });

  it("direct reference to chain cell returns initial value", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + 1, 42)",
      B1: "= x",
    });
    expect(scalarValue(sheet, "B1")).toBe(42);
  });

  it("chain self-reference by cell address", () => {
    const sheet = makeSheet({
      A1: "= Chain(A1 + 1, 0)",
      B1: "= A1[5]",
    });
    expect(sheet.cells.get("A1")!.error).toBeUndefined();
    expect(scalarValue(sheet, "A1")).toBe(0);
    expect(mean(sheet, "B1")).toBeCloseTo(5, 5);
  });

  it("non-chain self-reference is a cycle error", () => {
    const sheet = makeSheet({ A1: "= A1 + 1" });
    expect(sheet.cells.get("A1")!.error).toBeDefined();
  });

  it("non-chain variable self-reference is a cycle error", () => {
    const sheet = makeSheet({ A1: "x = x + 1" });
    expect(sheet.cells.get("A1")!.error).toBeDefined();
  });
});

describe("ChainIndex search", () => {
  it("finds first step where mean exceeds threshold", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + 10, 0)",
      B1: "= ChainIndex(x, mean(x) > 45)",
    });
    // x at step 0=0, 1=10, 2=20, 3=30, 4=40, 5=50
    // mean(x) > 45 first true at step 5 (mean=50)
    expect(scalarValue(sheet, "B1")).toBe(5);
  });

  it("returns step 0 when condition is immediately true", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + 1, 100)",
      B1: "= ChainIndex(x, mean(x) > 50)",
    });
    expect(scalarValue(sheet, "B1")).toBe(0);
  });

  it("errors when search limit exceeded", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x, 0)",
      B1: "= ChainIndex(x, mean(x) > 100)",
    });
    expect(sheet.cells.get("B1")!.error).toContain("search limit");
  });

  it("works with P() condition", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + 10, 0)",
      B1: "= ChainIndex(x, P(x, 50) > 25)",
    });
    // Deterministic chain: P50 = mean. P50 > 25 first at step 3 (=30)
    expect(scalarValue(sheet, "B1")).toBe(3);
  });

  it("works with min/max conditions", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + 10, 0)",
      B1: "= ChainIndex(x, min(x) > 15)",
    });
    // Deterministic chain: min = mean. min > 15 first at step 2 (=20)
    expect(scalarValue(sheet, "B1")).toBe(2);
  });

  it("errors on non-scalar condition", () => {
    const sheet = makeSheet({
      A1: "x = Chain(x + Normal(1, 0.1), 0)",
      B1: "= ChainIndex(x, x > 100)",
    }, 100);
    // x > 100 produces samples, not a scalar
    expect(sheet.cells.get("B1")!.error).toContain("scalar");
  });
});

// ─── Aggregate functions and ranges ─────────────────────────────────

describe("aggregate functions", () => {
  describe("sum", () => {
    it("sums scalars in a cell range", () => {
      const sheet = makeSheet({ A1: "10", A2: "20", A3: "30", B1: "= sum(A1:A3)" });
      expect(isScalar(sheet, "B1")).toBe(true);
      expect(scalarValue(sheet, "B1")).toBe(60);
    });

    it("sums distributions in a cell range elementwise", () => {
      const sheet = makeSheet({
        A1: "Normal(100, 10)", A2: "Normal(200, 10)", B1: "= sum(A1:A2)",
      }, 5_000);
      expect(isScalar(sheet, "B1")).toBe(false);
      expect(mean(sheet, "B1")).toBeCloseTo(300, -1);
    });

    it("sums multiple explicit arguments", () => {
      const sheet = makeSheet({ A1: "10", A2: "20", B1: "= sum(A1, A2, 5)" });
      expect(scalarValue(sheet, "B1")).toBe(35);
    });

    it("single distribution argument is identity", () => {
      const sheet = makeSheet({ A1: "Normal(100, 10)", B1: "= sum(A1)" }, 5_000);
      expect(isScalar(sheet, "B1")).toBe(false);
      expect(mean(sheet, "B1")).toBeCloseTo(100, -1);
    });

    it("sums chain step range", () => {
      // Chain that adds 1 each step: step 0 = 0, step 1 = 1, ..., step 5 = 5
      // ChainIndex always returns samples, so sum is a distribution (all samples = 15)
      const sheet = makeSheet({ A1: "x = Chain(x + 1, 0)", B1: "= sum(x[0:5])" });
      expect(mean(sheet, "B1")).toBeCloseTo(15, 5);
    });

    it("sums chain step range with shorthand [:n]", () => {
      const sheet = makeSheet({ A1: "x = Chain(x + 1, 0)", B1: "= sum(x[:3])" });
      expect(mean(sheet, "B1")).toBeCloseTo(6, 5);
    });

    it("2D cell range", () => {
      const sheet = makeSheet({ A1: "1", B1: "2", A2: "3", B2: "4", C1: "= sum(A1:B2)" });
      expect(scalarValue(sheet, "C1")).toBe(10);
    });
  });

  describe("product", () => {
    it("multiplies scalars in a range", () => {
      const sheet = makeSheet({ A1: "2", A2: "3", A3: "5", B1: "= product(A1:A3)" });
      expect(scalarValue(sheet, "B1")).toBe(30);
    });

    it("single argument is identity", () => {
      const sheet = makeSheet({ A1: "42", B1: "= product(A1)" });
      expect(scalarValue(sheet, "B1")).toBe(42);
    });
  });

  describe("mean", () => {
    it("averages scalars in a range", () => {
      const sheet = makeSheet({ A1: "10", A2: "20", A3: "30", B1: "= mean(A1:A3)" });
      expect(scalarValue(sheet, "B1")).toBe(20);
    });

    it("averages distributions elementwise", () => {
      const sheet = makeSheet({
        A1: "Normal(100, 10)", A2: "Normal(200, 10)", B1: "= mean(A1:A2)",
      }, 5_000);
      expect(isScalar(sheet, "B1")).toBe(false);
      expect(mean(sheet, "B1")).toBeCloseTo(150, -1);
    });

    it("collapses single distribution to expected value (scalar)", () => {
      const sheet = makeSheet({ A1: "Normal(100, 10)", B1: "= mean(A1)" }, 10_000);
      expect(isScalar(sheet, "B1")).toBe(true);
      expect(scalarValue(sheet, "B1")).toBeCloseTo(100, 0);
    });

    it("single scalar is identity", () => {
      const sheet = makeSheet({ A1: "42", B1: "= mean(A1)" });
      expect(scalarValue(sheet, "B1")).toBe(42);
    });

    it("averages chain step range", () => {
      // Chain: step 0 = 0, step 1 = 1, ..., step 4 = 4
      // Chain range always produces samples, so mean over range → distribution
      const sheet = makeSheet({ A1: "x = Chain(x + 1, 0)", B1: "= mean(x[0:4])" });
      expect(mean(sheet, "B1")).toBeCloseTo(2, 5);
    });
  });

  describe("median", () => {
    it("collapses single distribution to P50 (scalar)", () => {
      // Uniform(0, 100) has median 50
      const sheet = makeSheet({ A1: "Uniform(0, 100)", B1: "= median(A1)" }, 10_000);
      expect(isScalar(sheet, "B1")).toBe(true);
      expect(Math.abs(scalarValue(sheet, "B1") - 50)).toBeLessThan(2);
    });

    it("computes elementwise median of range", () => {
      const sheet = makeSheet({ A1: "10", A2: "20", A3: "30", B1: "= median(A1:A3)" });
      expect(scalarValue(sheet, "B1")).toBe(20);
    });

    it("computes median of even-length range correctly", () => {
      const sheet = makeSheet({ A1: "10", A2: "20", A3: "30", A4: "40", B1: "= median(A1:A4)" });
      expect(scalarValue(sheet, "B1")).toBe(25);
    });

    it("agrees with P(dist, 50)", () => {
      const sheet = makeSheet({
        A1: "Normal(100, 10)",
        B1: "= median(A1)",
        C1: "= P(A1, 50)",
      }, 10_000);
      expect(scalarValue(sheet, "B1")).toBe(scalarValue(sheet, "C1"));
    });
  });

  describe("P (percentile)", () => {
    it("computes P95 of a distribution", () => {
      // Normal(0,1): P95 ≈ 1.645
      const sheet = makeSheet({ A1: "Normal(0, 1)", B1: "= P(A1, 95)" }, 50_000);
      expect(isScalar(sheet, "B1")).toBe(true);
      expect(scalarValue(sheet, "B1")).toBeCloseTo(1.645, 1);
    });

    it("P0 gives minimum, P100 gives maximum", () => {
      const sheet = makeSheet({ A1: "Uniform(10, 20)", B1: "= P(A1, 0)", C1: "= P(A1, 100)" }, 10_000);
      expect(scalarValue(sheet, "B1")).toBeCloseTo(10, 0);
      expect(scalarValue(sheet, "C1")).toBeCloseTo(20, 0);
    });

    it("P of scalar returns that scalar", () => {
      const sheet = makeSheet({ A1: "42", B1: "= P(A1, 95)" });
      expect(scalarValue(sheet, "B1")).toBe(42);
    });

    it("interpolates correctly for small arrays", () => {
      // 4 values [1,2,3,4]: P50 should be 2.5 (interpolated)
      const sheet = makeSheet({
        A1: "1", A2: "2", A3: "3", A4: "4",
        // Use a trick: sum each value with a zero-sample distribution to force into samples
        // Actually, let's just test via the median agreement
        B1: "= median(A1:A4)",
      });
      expect(scalarValue(sheet, "B1")).toBe(25 / 10); // 2.5
    });

    it("errors with wrong arg count", () => {
      const sheet = makeSheet({ A1: "Normal(0, 1)", B1: "= P(A1)" });
      expect(sheet.cells.get("B1")!.error).toMatch(/takes 2 arguments/);
    });
  });

  describe("geomean", () => {
    it("collapses single distribution to geometric mean", () => {
      // LogNormal(0, 1): geometric mean = exp(0) = 1
      const sheet = makeSheet({ A1: "LogNormal(0, 1)", B1: "= geomean(A1)" }, 10_000);
      expect(isScalar(sheet, "B1")).toBe(true);
      expect(scalarValue(sheet, "B1")).toBeCloseTo(1, 0);
    });

    it("computes geometric mean of scalar range", () => {
      const sheet = makeSheet({ A1: "2", A2: "8", B1: "= geomean(A1:A2)" });
      expect(scalarValue(sheet, "B1")).toBeCloseTo(4, 5); // sqrt(16) = 4
    });
  });

  describe("min and max (extended)", () => {
    it("min of 2 args works as before", () => {
      const sheet = makeSheet({ A1: "10", A2: "20", B1: "= min(A1, A2)" });
      expect(scalarValue(sheet, "B1")).toBe(10);
    });

    it("min of range", () => {
      const sheet = makeSheet({ A1: "30", A2: "10", A3: "20", B1: "= min(A1:A3)" });
      expect(scalarValue(sheet, "B1")).toBe(10);
    });

    it("min of single distribution collapses to sample minimum", () => {
      const sheet = makeSheet({ A1: "Uniform(5, 10)", B1: "= min(A1)" }, 10_000);
      expect(isScalar(sheet, "B1")).toBe(true);
      expect(scalarValue(sheet, "B1")).toBeCloseTo(5, 0);
    });

    it("max of single distribution collapses to sample maximum", () => {
      const sheet = makeSheet({ A1: "Uniform(5, 10)", B1: "= max(A1)" }, 10_000);
      expect(isScalar(sheet, "B1")).toBe(true);
      expect(scalarValue(sheet, "B1")).toBeCloseTo(10, 0);
    });

    it("max of range", () => {
      const sheet = makeSheet({ A1: "10", A2: "30", A3: "20", B1: "= max(A1:A3)" });
      expect(scalarValue(sheet, "B1")).toBe(30);
    });

    it("min of 3 distributions elementwise", () => {
      // min of Normal(100,1), Normal(200,1), Normal(300,1) ≈ Normal(100,1)
      const sheet = makeSheet({
        A1: "Normal(100, 1)", A2: "Normal(200, 1)", A3: "Normal(300, 1)",
        B1: "= min(A1, A2, A3)",
      }, 5_000);
      expect(isScalar(sheet, "B1")).toBe(false);
      expect(mean(sheet, "B1")).toBeCloseTo(100, 0);
    });

    it("nested min(max(...)) collapses to scalar", () => {
      // max of 3 distributions → distribution, then min of that → scalar
      const sheet = makeSheet({
        A1: "Normal(100, 10)", A2: "Normal(200, 10)", A3: "Normal(300, 10)",
        B1: "= min(max(A1, A2, A3))",
      }, 5_000);
      expect(isScalar(sheet, "B1")).toBe(true);
      // max elementwise of 3 normals ≈ 300-ish, min sample of that ≈ 270-ish
      expect(scalarValue(sheet, "B1")).toBeGreaterThan(250);
      expect(scalarValue(sheet, "B1")).toBeLessThan(310);
    });
  });

  describe("chain bracket syntax", () => {
    it("income[5] accesses step 5", () => {
      const sheet = makeSheet({
        A1: "x = Chain(x + 10, 0)",
        B1: "= x[5]",
      });
      // With deterministic body, all samples = 50
      expect(mean(sheet, "B1")).toBeCloseTo(50, 5);
    });

    it("chain range with distribution body", () => {
      const sheet = makeSheet({
        A1: "x = Chain(x + Normal(10, 1), 0)",
        B1: "= mean(x[1:12])",
      }, 5_000);
      // mean of steps 1-12: step k ≈ k*10, mean ≈ (10+20+...+120)/12 = 65
      expect(isScalar(sheet, "B1")).toBe(false);
      expect(mean(sheet, "B1")).toBeCloseTo(65, -1);
    });
  });

  describe("error handling", () => {
    it("sum with no arguments errors", () => {
      const sheet = makeSheet({ A1: "= sum()" });
      expect(sheet.cells.get("A1")!.error).toMatch(/requires at least 1 argument/);
    });

    it("chain range on non-chain cell errors", () => {
      const sheet = makeSheet({ A1: "42", B1: "= sum(A1[0:5])" });
      expect(sheet.cells.get("B1")!.error).toMatch(/Chain/);
    });

    it("cell range outside function errors", () => {
      const sheet = makeSheet({ A1: "10", A2: "20", B1: "= A1:A2" });
      expect(sheet.cells.get("B1")!.error).toMatch(/ranges.*function/i);
    });

    it("chain range with negative start errors", () => {
      const sheet = makeSheet({ A1: "x = Chain(x + 1, 0)", B1: "= sum(x[-1:5])" });
      expect(sheet.cells.get("B1")!.error).toMatch(/Invalid/i);
    });
  });

  describe("histogram", () => {
    it("does not drop the right spike when snapping shifts the range left", () => {
      // Reproducer: 3300 + if(Bernoulli(.5), 2300/12, 0) — two atoms at 3300 and 3491.67.
      // The old snap set snappedMin = floor(3300 / binWidth) * binWidth = 3298.58
      // and snappedMax = snappedMin + range = 3490.25, so samples at 3491.67 fell
      // outside snappedMax and were skipped, leaving only the left spike visible.
      const n = 10_000;
      const vals = new Float64Array(n);
      for (let i = 0; i < n; i++) vals[i] = 3300 + (i % 2 === 0 ? 2300 / 12 : 0);
      const h = histogram({ kind: "samples", values: vals }, 100);
      const total = h.bins.reduce((a, b) => a + b, 0);
      expect(total).toBe(n);
      // Both spikes must land in separate bins.
      const nonEmpty = h.bins.filter((c) => c > 0).length;
      expect(nonEmpty).toBe(2);
      expect(h.bins[0]).toBe(n / 2);
      expect(h.bins[h.bins.length - 1]).toBe(n / 2);
    });
  });
});
