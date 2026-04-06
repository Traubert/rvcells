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

    it("parses Pareto", () => {
      const { content } = parseCell("Pareto(1, 2.5)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "Pareto", xMin: 1, alpha: 2.5 },
      });
    });

    it("parses Poisson", () => {
      const { content } = parseCell("Poisson(5)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "Poisson", lambda: 5 },
      });
    });

    it("parses StudentT with 1 arg", () => {
      const { content } = parseCell("StudentT(3)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "StudentT", nu: 3, mu: 0, sigma: 1 },
      });
    });

    it("parses StudentT with 3 args", () => {
      const { content } = parseCell("StudentT(4, 100, 15)");
      expect(content).toEqual({
        kind: "distribution",
        dist: { type: "StudentT", nu: 4, mu: 100, sigma: 15 },
      });
    });

    it("rejects StudentT with 2 args", () => {
      expect(parseCell("StudentT(3, 5)").content.kind).toBe("text");
    });

    it("rejects unknown distribution names", () => {
      expect(parseCell("Gaussian(5, 1)").content.kind).toBe("text");
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

    it("parses variable assignment with :=", () => {
      const result = parseCell("subtotal := D3 + D4");
      expect(result.variableName).toBe("subtotal");
      expect(result.content.kind).toBe("formula");
      expect(result.labelVar).toBeUndefined();
    });

    it("parses variable with := and distribution", () => {
      const result = parseCell("income := Normal(5000, 500)");
      expect(result.variableName).toBe("income");
      expect(result.content.kind).toBe("distribution");
    });

    it("parses variable with := and number", () => {
      const result = parseCell("rate := 0.05");
      expect(result.variableName).toBe("rate");
      expect(result.content).toEqual({ kind: "number", value: 0.05 });
    });

    it("allows unicode letters in variable names", () => {
      const result = parseCell("inkomst = Normal(5000, 500)");
      expect(result.variableName).toBe("inkomst");
      expect(result.content.kind).toBe("distribution");
    });

    it("allows unicode letters with diacritics", () => {
      const result = parseCell("årlig_inkomst = 12000");
      expect(result.variableName).toBe("årlig_inkomst");
      expect(result.content).toEqual({ kind: "number", value: 12000 });
    });

    it("allows CJK variable names", () => {
      const result = parseCell("収入 = A1 + B1");
      expect(result.variableName).toBe("収入");
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

  describe("comparison operators", () => {
    it("parses == operator", () => {
      expect(parseExpr("A1 == 4")).toEqual({
        type: "binOp",
        op: "==",
        left: { type: "cellRef", col: 0, row: 0 },
        right: { type: "number", value: 4 },
      });
    });

    it("parses != operator", () => {
      expect(parseExpr("A1 != 0")).toEqual({
        type: "binOp",
        op: "!=",
        left: { type: "cellRef", col: 0, row: 0 },
        right: { type: "number", value: 0 },
      });
    });

    it("parses > operator", () => {
      expect(parseExpr("A1 > 5")).toEqual({
        type: "binOp",
        op: ">",
        left: { type: "cellRef", col: 0, row: 0 },
        right: { type: "number", value: 5 },
      });
    });

    it("parses < operator", () => {
      expect(parseExpr("A1 < 10")).toEqual({
        type: "binOp",
        op: "<",
        left: { type: "cellRef", col: 0, row: 0 },
        right: { type: "number", value: 10 },
      });
    });

    it("parses >= operator", () => {
      expect(parseExpr("A1 >= 3")).toEqual({
        type: "binOp",
        op: ">=",
        left: { type: "cellRef", col: 0, row: 0 },
        right: { type: "number", value: 3 },
      });
    });

    it("parses <= operator", () => {
      expect(parseExpr("A1 <= 7")).toEqual({
        type: "binOp",
        op: "<=",
        left: { type: "cellRef", col: 0, row: 0 },
        right: { type: "number", value: 7 },
      });
    });

    it("comparisons have lower precedence than arithmetic", () => {
      // 1 + 2 == 3 should parse as (1 + 2) == 3
      const result = parseExpr("1 + 2 == 3");
      expect(result).toEqual({
        type: "binOp",
        op: "==",
        left: {
          type: "binOp",
          op: "+",
          left: { type: "number", value: 1 },
          right: { type: "number", value: 2 },
        },
        right: { type: "number", value: 3 },
      });
    });

    it("comparisons work inside function calls", () => {
      const result = parseExpr("if(state == 2, A1, B1)");
      expect(result).toEqual({
        type: "funcCall",
        name: "if",
        args: [
          {
            type: "binOp",
            op: "==",
            left: { type: "varRef", name: "state" },
            right: { type: "number", value: 2 },
          },
          { type: "cellRef", col: 0, row: 0 },
          { type: "cellRef", col: 1, row: 0 },
        ],
      });
    });
  });

  describe("Markov expressions", () => {
    it("parses basic Markov with two variable states", () => {
      const result = parseExpr("Markov(s0: 0.9 -> s0, 0.1 -> s1; s1: 0.2 -> s0, 0.8 -> s1)");
      expect(result).toEqual({
        type: "markov",
        states: [
          { name: "s0", emission: { type: "varRef", name: "s0" }, transitions: [{ prob: 0.9, target: "s0" }, { prob: 0.1, target: "s1" }] },
          { name: "s1", emission: { type: "varRef", name: "s1" }, transitions: [{ prob: 0.2, target: "s0" }, { prob: 0.8, target: "s1" }] },
        ],
        init: { kind: "deterministic", state: "s0" },
      });
    });

    it("defaults init to first state", () => {
      const result = parseExpr("Markov(a: 1 -> b; b: 1 -> a)");
      expect(result).toEqual({
        type: "markov",
        states: [
          { name: "a", emission: { type: "varRef", name: "a" }, transitions: [{ prob: 1, target: "b" }] },
          { name: "b", emission: { type: "varRef", name: "b" }, transitions: [{ prob: 1, target: "a" }] },
        ],
        init: { kind: "deterministic", state: "a" },
      });
    });

    it("parses explicit init with deterministic state", () => {
      const result = parseExpr("Markov(s0: 0.5 -> s1; s1: 0.5 -> s0; init s1)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.init).toEqual({ kind: "deterministic", state: "s1" });
      }
    });

    it("parses probabilistic init", () => {
      const result = parseExpr("Markov(s0: 0.5 -> s1; s1: 0.5 -> s0; init: 0.3 -> s0, 0.7 -> s1)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.init).toEqual({
          kind: "probabilistic",
          transitions: [{ prob: 0.3, target: "s0" }, { prob: 0.7, target: "s1" }],
        });
      }
    });

    it("parses single transition per state (implicit self-transition)", () => {
      const result = parseExpr("Markov(s0: 0.1 -> s1; s1: 0.2 -> s0)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].transitions).toEqual([{ prob: 0.1, target: "s1" }]);
        expect(result.states[1].transitions).toEqual([{ prob: 0.2, target: "s0" }]);
      }
    });

    it("parses three states", () => {
      const result = parseExpr("Markov(s0: 0.7 -> s0, 0.2 -> s1, 0.1 -> s2; s1: 0.8 -> s1, 0.2 -> s0; s2: 1 -> s2)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states).toHaveLength(3);
        expect(result.states.map(s => s.name)).toEqual(["s0", "s1", "s2"]);
      }
    });

    it("parses cell references as states", () => {
      const result = parseExpr("Markov(A1: 0.9 -> A1, 0.1 -> B1; B1: 0.2 -> A1, 0.8 -> B1)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].emission).toEqual({ type: "cellRef", col: 0, row: 0 });
        expect(result.states[1].emission).toEqual({ type: "cellRef", col: 1, row: 0 });
        // Cell ref names are lowercased addresses
        expect(result.states[0].name).toBe("a1");
        expect(result.states[1].name).toBe("b1");
        expect(result.states[0].transitions[1].target).toBe("b1");
      }
    });

    it("parses mixed variable and cell ref states", () => {
      const result = parseExpr("Markov(employed: 0.9 -> employed, 0.1 -> A1; A1: 0.5 -> employed, 0.5 -> A1)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].emission).toEqual({ type: "varRef", name: "employed" });
        expect(result.states[1].emission).toEqual({ type: "cellRef", col: 0, row: 0 });
      }
    });

    it("parses cross-sheet variable references", () => {
      const result = parseExpr("Markov(Data.emp: 0.5 -> Data.unemp; Data.unemp: 0.5 -> Data.emp)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].emission).toEqual({ type: "sheetVarRef", sheet: "Data", name: "emp" });
        expect(result.states[0].name).toBe("data.emp");
        expect(result.states[0].transitions[0].target).toBe("data.unemp");
      }
    });

    it("parses quoted cross-sheet references", () => {
      const result = parseExpr("Markov('My Sheet'.s0: 1 -> 'My Sheet'.s1; 'My Sheet'.s1: 1 -> 'My Sheet'.s0)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].emission).toEqual({ type: "sheetVarRef", sheet: "My Sheet", name: "s0" });
        expect(result.states[0].name).toBe("'my sheet'.s0");
      }
    });

    it("parses cross-sheet cell references", () => {
      const result = parseExpr("Markov(Data.A1: 0.5 -> Data.B1; Data.B1: 0.5 -> Data.A1)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].emission).toEqual({ type: "sheetCellRef", sheet: "Data", col: 0, row: 0 });
        expect(result.states[0].name).toBe("data.a1");
      }
    });

    it("parses init with cell ref", () => {
      const result = parseExpr("Markov(A1: 0.5 -> B1; B1: 0.5 -> A1; init B1)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.init).toEqual({ kind: "deterministic", state: "b1" });
      }
    });

    it("parses inline emission definitions", () => {
      const result = parseExpr("Markov(s0 = Normal(100, 10): 0.5 -> s0, 0.5 -> s1; s1 = Uniform(0, 50): 1 -> s0)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].name).toBe("s0");
        expect(result.states[0].emission).toEqual({
          type: "funcCall", name: "normal", args: [
            { type: "number", value: 100 },
            { type: "number", value: 10 },
          ],
        });
        expect(result.states[1].name).toBe("s1");
        expect(result.states[1].emission).toEqual({
          type: "funcCall", name: "uniform", args: [
            { type: "number", value: 0 },
            { type: "number", value: 50 },
          ],
        });
      }
    });

    it("parses inline emission with complex expression", () => {
      const result = parseExpr("Markov(s0 = A1 + Normal(10, 1): 0.5 -> s1; s1 = 0: 1 -> s0)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].emission.type).toBe("binOp");
        expect(result.states[1].emission).toEqual({ type: "number", value: 0 });
      }
    });

    it("mixes inline and reference states", () => {
      const result = parseExpr("Markov(s0: 0.5 -> s0, 0.5 -> s1; s1 = Normal(0, 1): 1 -> s0)");
      expect(result.type).toBe("markov");
      if (result.type === "markov") {
        expect(result.states[0].emission).toEqual({ type: "varRef", name: "s0" });
        expect(result.states[1].emission.type).toBe("funcCall");
      }
    });

    it("works in variable assignment", () => {
      const result = parseCell("state = Markov(s0: 0.9 -> s0, 0.1 -> s1; s1: 0.5 -> s0, 0.5 -> s1)");
      expect(result.variableName).toBe("state");
      expect(result.content.kind).toBe("formula");
      if (result.content.kind === "formula") {
        expect(result.content.expr.type).toBe("markov");
      }
    });

    it("throws on empty Markov", () => {
      expect(() => parseExpr("Markov()")).toThrow("requires at least one state");
    });

    it("throws on missing colon", () => {
      expect(() => parseExpr("Markov(s0 0.5 -> s1)")).toThrow(":");
    });

    it("throws on missing arrow", () => {
      expect(() => parseExpr("Markov(s0: 0.5 s1)")).toThrow("->");
    });
  });

  describe("cell ranges", () => {
    it("parses A1:A10", () => {
      expect(parseExpr("A1:A10")).toEqual({
        type: "cellRange", startCol: 0, startRow: 0, endCol: 0, endRow: 9,
      });
    });

    it("parses 2D range A1:C3", () => {
      expect(parseExpr("A1:C3")).toEqual({
        type: "cellRange", startCol: 0, startRow: 0, endCol: 2, endRow: 2,
      });
    });

    it("parses cell range inside function call", () => {
      const result = parseExpr("sum(A1:A10)");
      expect(result).toEqual({
        type: "funcCall",
        name: "sum",
        args: [{ type: "cellRange", startCol: 0, startRow: 0, endCol: 0, endRow: 9 }],
      });
    });
  });

  describe("chain bracket syntax", () => {
    it("parses single index as chainStep", () => {
      expect(parseExpr("income[5]")).toEqual({
        type: "chainStep",
        target: { type: "varRef", name: "income" },
        step: { type: "number", value: 5 },
      });
    });

    it("parses range income[0:35]", () => {
      expect(parseExpr("income[0:35]")).toEqual({
        type: "chainRange",
        target: { type: "varRef", name: "income" },
        start: { type: "number", value: 0 },
        end: { type: "number", value: 35 },
      });
    });

    it("parses shorthand income[:35] with start=0", () => {
      expect(parseExpr("income[:35]")).toEqual({
        type: "chainRange",
        target: { type: "varRef", name: "income" },
        start: { type: "number", value: 0 },
        end: { type: "number", value: 35 },
      });
    });

    it("parses bracket on cell ref", () => {
      expect(parseExpr("A1[0:5]")).toEqual({
        type: "chainRange",
        target: { type: "cellRef", col: 0, row: 0 },
        start: { type: "number", value: 0 },
        end: { type: "number", value: 5 },
      });
    });

    it("parses bracket on cross-sheet ref", () => {
      const result = parseExpr("Data.income[0:12]");
      expect(result.type).toBe("chainRange");
      if (result.type === "chainRange") {
        expect(result.target).toEqual({ type: "sheetVarRef", sheet: "Data", name: "income" });
        expect(result.start).toEqual({ type: "number", value: 0 });
        expect(result.end).toEqual({ type: "number", value: 12 });
      }
    });

    it("parses chain range inside function call", () => {
      const result = parseExpr("sum(income[0:11])");
      expect(result).toEqual({
        type: "funcCall",
        name: "sum",
        args: [{
          type: "chainRange",
          target: { type: "varRef", name: "income" },
          start: { type: "number", value: 0 },
          end: { type: "number", value: 11 },
        }],
      });
    });

    it("parses expression indices", () => {
      const result = parseExpr("income[n - 1]");
      expect(result.type).toBe("chainStep");
      if (result.type === "chainStep") {
        expect(result.target).toEqual({ type: "varRef", name: "income" });
        expect(result.step.type).toBe("binOp");
      }
    });
  });

  describe("pinned cell references ($)", () => {
    it("parses $A1 as pinned column", () => {
      expect(parseExpr("$A1")).toEqual({ type: "cellRef", col: 0, row: 0, pinCol: true });
    });

    it("parses A$1 as pinned row", () => {
      expect(parseExpr("A$1")).toEqual({ type: "cellRef", col: 0, row: 0, pinRow: true });
    });

    it("parses $A$1 as both pinned", () => {
      expect(parseExpr("$A$1")).toEqual({ type: "cellRef", col: 0, row: 0, pinCol: true, pinRow: true });
    });

    it("parses unpinned as before (no pin properties)", () => {
      expect(parseExpr("A1")).toEqual({ type: "cellRef", col: 0, row: 0 });
    });

    it("parses pinned refs in expressions", () => {
      const result = parseExpr("$A1 + B$2");
      expect(result).toEqual({
        type: "binOp",
        op: "+",
        left: { type: "cellRef", col: 0, row: 0, pinCol: true },
        right: { type: "cellRef", col: 1, row: 1, pinRow: true },
      });
    });
  });
});
