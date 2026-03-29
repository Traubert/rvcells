import type { CellContent, Distribution, Expr } from "./types";

/**
 * Parse raw cell input into structured CellContent.
 *
 * Syntax:
 *   ""                        → empty
 *   "123" / "3.14"            → number
 *   "Normal(100, 10)"         → distribution
 *   "= A1 + B2"              → formula
 *   "income = A1 * 12"       → formula with variable name
 *   ":= A1 + B2"             → formula, variable name from left neighbour cell
 *   anything else             → text
 *
 * Returns { content, variableName?, labelVar? }
 * labelVar=true means the variable name should be derived from the cell to the left.
 */
export function parseCell(raw: string): { content: CellContent; variableName?: string; labelVar?: boolean } {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return { content: { kind: "empty" } };
  }

  // Check for variable assignment: "name = ..."
  // But NOT "= ..." (that's a formula without a variable name)
  const varMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
  if (varMatch) {
    const varName = varMatch[1].toLowerCase();
    const rhs = varMatch[2].trim();

    // The RHS could be a number, distribution, or formula expression
    const rhsParsed = parseRHS(rhs);
    if (rhsParsed) {
      return { content: rhsParsed, variableName: varName };
    }
    // If RHS didn't parse as formula/dist/number, treat whole thing as text
    return { content: { kind: "text", value: trimmed } };
  }

  // Label-variable formula: starts with ":="
  if (trimmed.startsWith(":=")) {
    const exprStr = trimmed.slice(2).trim();
    const rhsParsed = parseRHS(exprStr);
    if (rhsParsed) {
      return { content: rhsParsed, labelVar: true };
    }
    return { content: { kind: "text", value: trimmed } };
  }

  // Formula: starts with "="
  if (trimmed.startsWith("=")) {
    const exprStr = trimmed.slice(1).trim();
    try {
      const expr = parseExpr(exprStr);
      return { content: { kind: "formula", expr } };
    } catch {
      return { content: { kind: "text", value: trimmed } };
    }
  }

  // Try as number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== "") {
    return { content: { kind: "number", value: num } };
  }

  // Try as distribution
  const dist = parseDistribution(trimmed);
  if (dist) {
    return { content: { kind: "distribution", dist } };
  }

  // Fallback: text
  return { content: { kind: "text", value: trimmed } };
}

/** Parse the RHS of a variable assignment — could be number, distribution, or expression */
function parseRHS(rhs: string): CellContent | null {
  // Number?
  const num = Number(rhs);
  if (!isNaN(num) && rhs !== "") {
    return { kind: "number", value: num };
  }

  // Distribution?
  const dist = parseDistribution(rhs);
  if (dist) {
    return { kind: "distribution", dist };
  }

  // Expression?
  try {
    const expr = parseExpr(rhs);
    return { kind: "formula", expr };
  } catch {
    return null;
  }
}

/** Parse a distribution like "Normal(100, 10)" */
function parseDistribution(s: string): Distribution | null {
  const match = s.match(/^(\w+)\(([^)]+)\)$/);
  if (!match) return null;

  const name = match[1];
  const args = match[2].split(",").map((a) => {
    const n = Number(a.trim());
    if (isNaN(n)) throw new Error("Bad distribution argument");
    return n;
  });

  switch (name) {
    case "Normal":
      if (args.length === 2) return { type: "Normal", mean: args[0], std: args[1] };
      break;
    case "LogNormal":
      if (args.length === 2) return { type: "LogNormal", mu: args[0], sigma: args[1] };
      break;
    case "Uniform":
      if (args.length === 2) return { type: "Uniform", low: args[0], high: args[1] };
      break;
    case "Triangular":
      if (args.length === 3)
        return { type: "Triangular", low: args[0], mode: args[1], high: args[2] };
      break;
    case "Beta":
      if (args.length === 2) return { type: "Beta", alpha: args[0], beta: args[1] };
      break;
  }

  return null;
}

// ─── Expression parser (recursive descent) ────────────────────────────

type Token =
  | { type: "number"; value: number }
  | { type: "cellRef"; col: number; row: number }
  | { type: "ident"; name: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (input[i] === " " || input[i] === "\t") {
      i++;
      continue;
    }

    // Number (including decimals)
    if (/[0-9.]/.test(input[i])) {
      let num = "";
      while (i < input.length && /[0-9.eE]/.test(input[i])) {
        num += input[i++];
      }
      tokens.push({ type: "number", value: Number(num) });
      continue;
    }

    // Identifier or cell reference
    if (/[a-zA-Z_]/.test(input[i])) {
      let word = "";
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        word += input[i++];
      }
      // Cell reference: one or more uppercase letters followed by digits
      const cellMatch = word.match(/^([A-Z]+)(\d+)$/);
      if (cellMatch) {
        let col = 0;
        for (const ch of cellMatch[1]) {
          col = col * 26 + (ch.charCodeAt(0) - 64);
        }
        col -= 1;
        const row = parseInt(cellMatch[2], 10) - 1;
        tokens.push({ type: "cellRef", col, row });
      } else {
        tokens.push({ type: "ident", name: word.toLowerCase() });
      }
      continue;
    }

    // Operators and punctuation
    if ("+-*/".includes(input[i])) {
      tokens.push({ type: "op", value: input[i++] });
      continue;
    }
    if (input[i] === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (input[i] === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (input[i] === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }

    throw new Error(`Unexpected character: '${input[i]}' at position ${i}`);
  }

  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  /** expr = term (('+' | '-') term)* */
  parseExpression(): Expr {
    let left = this.parseTerm();
    while (this.peek()?.type === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.advance() as { type: "op"; value: string };
      const right = this.parseTerm();
      left = { type: "binOp", op: op.value as "+" | "-", left, right };
    }
    return left;
  }

  /** term = unary (('*' | '/') unary)* */
  private parseTerm(): Expr {
    let left = this.parseUnary();
    while (this.peek()?.type === "op" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      const op = this.advance() as { type: "op"; value: string };
      const right = this.parseUnary();
      left = { type: "binOp", op: op.value as "*" | "/", left, right };
    }
    return left;
  }

  /** unary = '-' unary | primary */
  private parseUnary(): Expr {
    if (this.peek()?.type === "op" && this.peek()!.value === "-") {
      this.advance();
      const operand = this.parseUnary();
      return { type: "unaryMinus", operand };
    }
    return this.parsePrimary();
  }

  /** primary = number | cellRef | ident '(' args ')' | ident | '(' expr ')' */
  private parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok) throw new Error("Unexpected end of expression");

    if (tok.type === "number") {
      this.advance();
      return { type: "number", value: tok.value };
    }

    if (tok.type === "cellRef") {
      this.advance();
      return { type: "cellRef", col: tok.col, row: tok.row };
    }

    if (tok.type === "ident") {
      this.advance();
      // Function call?
      if (this.peek()?.type === "lparen") {
        this.advance(); // consume '('
        const args: Expr[] = [];
        if (this.peek()?.type !== "rparen") {
          args.push(this.parseExpression());
          while (this.peek()?.type === "comma") {
            this.advance();
            args.push(this.parseExpression());
          }
        }
        if (this.peek()?.type !== "rparen") {
          throw new Error("Expected ')'");
        }
        this.advance(); // consume ')'
        return { type: "funcCall", name: tok.name, args };
      }
      // Variable reference
      return { type: "varRef", name: tok.name };
    }

    if (tok.type === "lparen") {
      this.advance();
      const expr = this.parseExpression();
      if (this.peek()?.type !== "rparen") {
        throw new Error("Expected ')'");
      }
      this.advance();
      return expr;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(tok)}`);
  }
}

/** Parse an expression string into an AST */
export function parseExpr(input: string): Expr {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Empty expression");
  const parser = new Parser(tokens);
  const expr = parser.parseExpression();
  return expr;
}
