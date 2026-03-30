import { describe, it, expect } from "vitest";
import { createSheet, setCellRaw, summarize, recalculateBulk, recalculateAllBulk, renameSheet, findRefsToSheet } from "./evaluate";
import type { Sheet } from "./types";
import { parseCell } from "./parser";

/** Helper: create a sheet and set multiple cells */
function makeSheet(cells: Record<string, string>, numSamples = 1_000): Sheet {
  const sheet = createSheet(numSamples);
  for (const [addr, raw] of Object.entries(cells)) {
    setCellRaw(sheet, addr, raw);
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
    const sheet = createSheet(100);
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
    const sheet = createSheet(100);
    setCellRaw(sheet, "A1", "= B1");
    setCellRaw(sheet, "B1", "= A1");
    // The second edit should be rejected
    expect(sheet.cells.get("B1")?.error).toMatch(/circular/i);
  });

  it("allows overwriting a cell that would remove a cycle", () => {
    const sheet = createSheet(100);
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
    const sheet = createSheet(100);
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
    const sheet = createSheet(100);
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
    const sheets = defs.map((d) => createSheet(1_000, d.name));
    // First set all cells without cross-sheet eval
    for (let si = 0; si < defs.length; si++) {
      for (const [addr, raw] of Object.entries(defs[si].cells)) {
        const { content, variableName, labelVar } = parseCell(raw);
        sheets[si].cells.set(addr, { raw, content, variableName, labelVar });
      }
    }
    recalculateAllBulk(sheets);
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
