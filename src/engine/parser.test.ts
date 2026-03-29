import { describe, it, expect } from "vitest";
import { parseCell, parseExpr } from "./parser";

describe("parseCell", () => {
  it("parses empty string", () => {
    expect(parseCell("").content).toEqual({ kind: "empty" });
    expect(parseCell("  ").content).toEqual({ kind: "empty" });
  });

  it("parses plain numbers", () => {
    expect(parseCell("42").content).toEqual({ kind: "number", value: 42 });
    expect(parseCell("3.14").content).toEqual({ kind: "number", value: 3.14 });
    expect(parseCell("-7").content).toEqual({ kind: "number", value: -7 });
    expect(parseCell("  100  ").content).toEqual({ kind: "number", value: 100 });
  });

  it("parses text", () => {
    expect(parseCell("hello").content).toEqual({ kind: "text", value: "hello" });
    expect(parseCell("some label").content).toEqual({ kind: "text", value: "some label" });
  });

  describe("distributions", () => {
    it("parses Normal", () => {
      const { content } = parseCell("Normal(100, 15)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "Normal", mean: 100, std: 15 },
      });
    });

    it("parses LogNormal", () => {
      const { content } = parseCell("LogNormal(5, 0.5)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "LogNormal", mu: 5, sigma: 0.5 },
      });
    });

    it("parses Uniform", () => {
      const { content } = parseCell("Uniform(10, 20)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "Uniform", low: 10, high: 20 },
      });
    });

    it("parses Triangular", () => {
      const { content } = parseCell("Triangular(1, 5, 10)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "Triangular", low: 1, mode: 5, high: 10 },
      });
    });

    it("parses Beta", () => {
      const { content } = parseCell("Beta(2, 5)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "Beta", alpha: 2, beta: 5 },
      });
    });

    it("rejects distributions with wrong arg count", () => {
      expect(parseCell("Normal(100)").content.kind).toBe("text");
      expect(parseCell("Normal(1, 2, 3)").content.kind).toBe("text");
      expect(parseCell("Triangular(1, 2)").content.kind).toBe("text");
    });

    it("rejects unknown distribution names", () => {
      expect(parseCell("Poisson(5)").content.kind).toBe("text");
    });
  });

  describe("formulas", () => {
    it("parses simple formula with =", () => {
      const { content } = parseCell("= 1 + 2");
      expect(content.kind).toBe("formula");
    });

    it("parses cell references", () => {
      const { content } = parseCell("= A1 + B2");
      expect(content).toEqual({
        kind: "formula",
        expr: {
          type: "binOp",
          op: "+",
          left: { type: "cellRef", col: 0, row: 0 },
          right: { type: "cellRef", col: 1, row: 1 },
        },
      });
    });

    it("falls back to text on bad formula", () => {
      expect(parseCell("= +").content.kind).toBe("text");
    });
  });

  describe("variable assignments", () => {
    it("parses variable with number", () => {
      const result = parseCell("income = 5000");
      expect(result.variableName).toBe("income");
      expect(result.content).toEqual({ kind: "number", value: 5000 });
    });

    it("parses variable with formula", () => {
      const result = parseCell("profit = A1 - B1");
      expect(result.variableName).toBe("profit");
      expect(result.content.kind).toBe("formula");
    });

    it("parses variable with distribution", () => {
      const result = parseCell("revenue = Normal(1000, 100)");
      expect(result.variableName).toBe("revenue");
      expect(result.content.kind).toBe("distribution");
    });

    it("normalizes variable names to lowercase", () => {
      expect(parseCell("Income = 100").variableName).toBe("income");
      expect(parseCell("MyVar = 100").variableName).toBe("myvar");
    });

    it("allows underscores in variable names", () => {
      const result = parseCell("net_income = A1 - B1");
      expect(result.variableName).toBe("net_income");
    });

    it("does not treat = prefix as variable assignment", () => {
      const result = parseCell("= A1 + 1");
      expect(result.variableName).toBeUndefined();
      expect(result.content.kind).toBe("formula");
    });
  });

  describe("label-variable (:=) syntax", () => {
    it("parses := with a number", () => {
      const result = parseCell(":= 5000");
      expect(result.labelVar).toBe(true);
      expect(result.variableName).toBeUndefined();
      expect(result.content).toEqual({ kind: "number", value: 5000 });
    });

    it("parses := with a formula", () => {
      const result = parseCell(":= A1 + B1");
      expect(result.labelVar).toBe(true);
      expect(result.content.kind).toBe("formula");
    });

    it("parses := with a distribution", () => {
      const result = parseCell(":= Normal(1000, 100)");
      expect(result.labelVar).toBe(true);
      expect(result.content.kind).toBe("distribution");
    });

    it("does not set variableName directly", () => {
      const result = parseCell(":= 5000");
      expect(result.variableName).toBeUndefined();
    });
  });
});

describe("parseExpr", () => {
  it("parses a number", () => {
    expect(parseExpr("42")).toEqual({ type: "number", value: 42 });
  });

  it("parses addition", () => {
    expect(parseExpr("1 + 2")).toEqual({
      type: "binOp",
      op: "+",
      left: { type: "number", value: 1 },
      right: { type: "number", value: 2 },
    });
  });

  it("respects operator precedence: * before +", () => {
    const result = parseExpr("1 + 2 * 3");
    expect(result).toEqual({
      type: "binOp",
      op: "+",
      left: { type: "number", value: 1 },
      right: {
        type: "binOp",
        op: "*",
        left: { type: "number", value: 2 },
        right: { type: "number", value: 3 },
      },
    });
  });

  it("respects parentheses", () => {
    const result = parseExpr("(1 + 2) * 3");
    expect(result).toEqual({
      type: "binOp",
      op: "*",
      left: {
        type: "binOp",
        op: "+",
        left: { type: "number", value: 1 },
        right: { type: "number", value: 2 },
      },
      right: { type: "number", value: 3 },
    });
  });

  it("parses unary minus", () => {
    expect(parseExpr("-5")).toEqual({
      type: "unaryMinus",
      operand: { type: "number", value: 5 },
    });
  });

  it("parses unary minus in expression", () => {
    const result = parseExpr("A1 * -2");
    expect(result).toEqual({
      type: "binOp",
      op: "*",
      left: { type: "cellRef", col: 0, row: 0 },
      right: { type: "unaryMinus", operand: { type: "number", value: 2 } },
    });
  });

  it("parses cell references", () => {
    expect(parseExpr("A1")).toEqual({ type: "cellRef", col: 0, row: 0 });
    expect(parseExpr("Z1")).toEqual({ type: "cellRef", col: 25, row: 0 });
    expect(parseExpr("B10")).toEqual({ type: "cellRef", col: 1, row: 9 });
  });

  it("parses variable references (lowercase identifiers)", () => {
    expect(parseExpr("income")).toEqual({ type: "varRef", name: "income" });
    expect(parseExpr("net_profit")).toEqual({ type: "varRef", name: "net_profit" });
  });

  it("parses complex expressions", () => {
    const result = parseExpr("A1 + B1 * 2 - C1 / 3");
    // Should be: (A1 + (B1 * 2)) - (C1 / 3)
    expect(result.type).toBe("binOp");
  });

  it("parses nested parentheses", () => {
    const result = parseExpr("((1 + 2))");
    expect(result).toEqual({
      type: "binOp",
      op: "+",
      left: { type: "number", value: 1 },
      right: { type: "number", value: 2 },
    });
  });

  it("parses left-associative subtraction", () => {
    // 10 - 3 - 2 should be (10 - 3) - 2, not 10 - (3 - 2)
    const result = parseExpr("10 - 3 - 2");
    expect(result).toEqual({
      type: "binOp",
      op: "-",
      left: {
        type: "binOp",
        op: "-",
        left: { type: "number", value: 10 },
        right: { type: "number", value: 3 },
      },
      right: { type: "number", value: 2 },
    });
  });

  it("parses left-associative division", () => {
    const result = parseExpr("12 / 3 / 2");
    expect(result).toEqual({
      type: "binOp",
      op: "/",
      left: {
        type: "binOp",
        op: "/",
        left: { type: "number", value: 12 },
        right: { type: "number", value: 3 },
      },
      right: { type: "number", value: 2 },
    });
  });

  it("throws on empty expression", () => {
    expect(() => parseExpr("")).toThrow();
  });

  it("throws on unclosed paren", () => {
    expect(() => parseExpr("(1 + 2")).toThrow();
  });

  it("throws on unexpected token", () => {
    expect(() => parseExpr("+")).toThrow();
  });

  it("parses function calls", () => {
    const result = parseExpr("max(A1, B1)");
    expect(result).toEqual({
      type: "funcCall",
      name: "max",
      args: [
        { type: "cellRef", col: 0, row: 0 },
        { type: "cellRef", col: 1, row: 0 },
      ],
    });
  });

  it("parses mixed variable refs and cell refs", () => {
    const result = parseExpr("income + A1 * tax_rate");
    expect(result).toEqual({
      type: "binOp",
      op: "+",
      left: { type: "varRef", name: "income" },
      right: {
        type: "binOp",
        op: "*",
        left: { type: "cellRef", col: 0, row: 0 },
        right: { type: "varRef", name: "tax_rate" },
      },
    });
  });
});
