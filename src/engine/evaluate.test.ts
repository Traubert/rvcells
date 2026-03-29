import { describe, it, expect } from "vitest";
import { createSheet, setCellRaw, summarize, recalculateBulk } from "./evaluate";
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
