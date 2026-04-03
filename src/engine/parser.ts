import type { CellContent, Distribution, Expr, MarkovInit, MarkovStateDef } from "./types";
import { toAddress } from "./types";
import { DISTRIBUTION_NAMES, ID_START, ID_CONT, ID_START_SRC, ID_CONT_SRC } from "../constants";

/**
 * Parse raw cell input into structured CellContent.
 *
 * Syntax:
 *   ""                        → empty
 *   "123" / "3.14"            → number
 *   "Normal(100, 10)"         → distribution
 *   "= A1 + B2"              → formula
 *   "income = A1 * 12"       → formula with variable name
 *   "income := A1 * 12"      → same (`:=` also accepted for explicit assignment)
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

  // Check for variable assignment: "name = ..." or "name := ..."
  // But NOT "= ..." (that's a formula without a variable name)
  const varMatch = trimmed.match(new RegExp(`^(${ID_START_SRC}${ID_CONT_SRC}*)\\s*:?=\\s*(.+)$`, "u"));
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
  if (!DISTRIBUTION_NAMES.has(name)) return null;

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
    case "Pareto":
      if (args.length === 2) return { type: "Pareto", xMin: args[0], alpha: args[1] };
      break;
    case "Poisson":
      if (args.length === 1) return { type: "Poisson", lambda: args[0] };
      break;
    case "StudentT":
      if (args.length === 1) return { type: "StudentT", nu: args[0], mu: 0, sigma: 1 };
      if (args.length === 3) return { type: "StudentT", nu: args[0], mu: args[1], sigma: args[2] };
      break;
  }

  return null;
}

// ─── Expression parser (recursive descent) ────────────────────────────

type Token =
  | { type: "number"; value: number }
  | { type: "cellRef"; col: number; row: number; pinCol: boolean; pinRow: boolean }
  | { type: "ident"; name: string; original: string }
  | { type: "quotedName"; name: string }
  | { type: "op"; value: string }
  | { type: "dot" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" }
  | { type: "arrow" }      // ->
  | { type: "colon" }      // :
  | { type: "semicolon" }  // ;
  | { type: "assign" };    // = (single, inside Markov inline definitions)

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (input[i] === " " || input[i] === "\t") {
      i++;
      continue;
    }

    // Quoted sheet name: 'Sheet Name'
    if (input[i] === "'") {
      i++; // skip opening quote
      let name = "";
      while (i < input.length && input[i] !== "'") {
        name += input[i++];
      }
      if (i >= input.length) throw new Error("Unterminated quoted name");
      i++; // skip closing quote
      tokens.push({ type: "quotedName", name });
      continue;
    }

    // Number (including decimals, but '.' alone is a dot operator)
    if (/[0-9]/.test(input[i]) || (input[i] === "." && i + 1 < input.length && /[0-9]/.test(input[i + 1]))) {
      let num = "";
      while (i < input.length && /[0-9.eE]/.test(input[i])) {
        num += input[i++];
      }
      tokens.push({ type: "number", value: Number(num) });
      continue;
    }

    // Cell reference with optional $ pins, or identifier
    // Matches: $A$1, $A1, A$1, A1, or plain identifiers
    if (input[i] === "$" || ID_START.test(input[i])) {
      // Try to parse as a cell reference: optional $ + uppercase letters + optional $ + digits
      const cellRefMatch = input.slice(i).match(/^(\$?)([A-Z]+)(\$?)(\d+)/);
      if (cellRefMatch) {
        const pinCol = cellRefMatch[1] === "$";
        const colStr = cellRefMatch[2];
        const pinRow = cellRefMatch[3] === "$";
        const rowStr = cellRefMatch[4];
        // Make sure the next char isn't a letter/digit/underscore (would mean it's an identifier)
        const matchLen = cellRefMatch[0].length;
        const nextChar = input[i + matchLen];
        if (!nextChar || !ID_CONT.test(nextChar)) {
          let col = 0;
          for (const ch of colStr) {
            col = col * 26 + (ch.charCodeAt(0) - 64);
          }
          col -= 1;
          const row = parseInt(rowStr, 10) - 1;
          tokens.push({ type: "cellRef", col, row, pinCol, pinRow });
          i += matchLen;
          continue;
        }
      }

      // Not a cell reference — parse as identifier (but not starting with $)
      if (ID_START.test(input[i])) {
        let word = "";
        while (i < input.length && ID_CONT.test(input[i])) {
          word += input[i++];
        }
        tokens.push({ type: "ident", name: word.toLowerCase(), original: word });
        continue;
      }

      // Lone $ — shouldn't happen in valid input, treat as error
      throw new Error(`Unexpected character: '$' at position ${i}`);
    }

    // Multi-character comparison operators
    if (input[i] === "=" && input[i + 1] === "=") {
      tokens.push({ type: "op", value: "==" });
      i += 2;
      continue;
    }
    if (input[i] === "!" && input[i + 1] === "=") {
      tokens.push({ type: "op", value: "!=" });
      i += 2;
      continue;
    }
    if (input[i] === ">" && input[i + 1] === "=") {
      tokens.push({ type: "op", value: ">=" });
      i += 2;
      continue;
    }
    if (input[i] === "<" && input[i + 1] === "=") {
      tokens.push({ type: "op", value: "<=" });
      i += 2;
      continue;
    }
    // Single-character comparison operators
    if (input[i] === ">" || input[i] === "<") {
      tokens.push({ type: "op", value: input[i++] });
      continue;
    }
    // Single = (assign, used in Markov inline definitions)
    if (input[i] === "=") {
      tokens.push({ type: "assign" });
      i++;
      continue;
    }

    // Arrow operator (must check before -)
    if (input[i] === "-" && input[i + 1] === ">") {
      tokens.push({ type: "arrow" });
      i += 2;
      continue;
    }

    // Arithmetic operators and punctuation
    if ("+-*/".includes(input[i])) {
      tokens.push({ type: "op", value: input[i++] });
      continue;
    }
    if (input[i] === ".") {
      tokens.push({ type: "dot" });
      i++;
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
    if (input[i] === ":") {
      tokens.push({ type: "colon" });
      i++;
      continue;
    }
    if (input[i] === ";") {
      tokens.push({ type: "semicolon" });
      i++;
      continue;
    }

    throw new Error(`Unexpected character: '${input[i]}' at position ${i}`);
  }

  return tokens;
}

/** Build a canonical label for a cross-sheet reference (used as Markov state name) */
function sheetRefLabel(sheetName: string, ref: Expr): string {
  if (ref.type === "sheetVarRef") return `${sheetName}.${ref.name}`.toLowerCase();
  if (ref.type === "sheetCellRef") return `${sheetName}.${toAddress(ref.col, ref.row)}`.toLowerCase();
  return sheetName.toLowerCase();
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

  private peekOp(): string | null {
    const tok = this.peek();
    return tok?.type === "op" ? tok.value : null;
  }

  private isComparisonOp(): boolean {
    const op = this.peekOp();
    return op === "==" || op === "!=" || op === ">" || op === "<" || op === ">=" || op === "<=";
  }

  /** expr = additive ((comparison_op) additive)* */
  parseExpression(): Expr {
    let left = this.parseAdditive();
    while (this.isComparisonOp()) {
      const op = this.advance() as { type: "op"; value: string };
      const right = this.parseAdditive();
      left = { type: "binOp", op: op.value as "==" | "!=" | ">" | "<" | ">=" | "<=", left, right };
    }
    return left;
  }

  /** additive = term (('+' | '-') term)* */
  private parseAdditive(): Expr {
    let left = this.parseTerm();
    while (this.peekOp() === "+" || this.peekOp() === "-") {
      const op = this.advance() as { type: "op"; value: string };
      const right = this.parseTerm();
      left = { type: "binOp", op: op.value as "+" | "-", left, right };
    }
    return left;
  }

  /** term = unary (('*' | '/') unary)* */
  private parseTerm(): Expr {
    let left = this.parseUnary();
    while (this.peekOp() === "*" || this.peekOp() === "/") {
      const op = this.advance() as { type: "op"; value: string };
      const right = this.parseUnary();
      left = { type: "binOp", op: op.value as "*" | "/", left, right };
    }
    return left;
  }

  /** unary = '-' unary | primary */
  private parseUnary(): Expr {
    if (this.peekOp() === "-") {
      this.advance();
      const operand = this.parseUnary();
      return { type: "unaryMinus", operand };
    }
    return this.parsePrimary();
  }

  /** Parse the ref after a dot in a cross-sheet reference */
  private parseSheetRef(sheetName: string): Expr {
    const next = this.peek();
    if (next?.type === "cellRef") {
      this.advance();
      return {
        type: "sheetCellRef",
        sheet: sheetName,
        col: next.col,
        row: next.row,
        ...(next.pinCol ? { pinCol: true } : {}),
        ...(next.pinRow ? { pinRow: true } : {}),
      };
    }
    if (next?.type === "ident") {
      this.advance();
      return { type: "sheetVarRef", sheet: sheetName, name: next.name };
    }
    throw new Error(`Expected cell reference or variable after '${sheetName}.'`);
  }

  /**
   * Parse Markov() arguments: state definitions separated by ';', optional 'init stateName'.
   * First state is initial unless 'init' overrides it.
   * Syntax: Markov(s0: 0.5 -> s1, 0.5 -> s2; s1: 0.8 -> s1, 0.2 -> s0; init s1)
   *
   * Inline emission definitions are also supported:
   *   Markov(s0 = Normal(100, 10): 0.5 -> s0, 0.5 -> s1; s1 = Uniform(0, 50): 1 -> s0)
   * Called after '(' has been consumed.
   */
  private parseMarkovArgs(): Expr {
    const states: MarkovStateDef[] = [];
    let init: MarkovInit | undefined;

    while (true) {
      const tok = this.peek();
      if (!tok || tok.type === "rparen") break;

      // 'init' clause: either 'init stateName' or 'init: prob -> state, ...'
      // Note: 'init = expr' would be parsed as an inline state named 'init', not as init clause.
      // This is fine — 'init' as a state name is unusual and the ambiguity resolves sensibly.
      if (tok.type === "ident" && tok.name === "init" && this.tokens[this.pos + 1]?.type !== "assign") {
        this.advance();
        if (this.peek()?.type === "colon") {
          this.advance(); // consume ':'
          init = { kind: "probabilistic", transitions: this.parseTransitionList() };
        } else {
          const { name } = this.parseMarkovRef();
          init = { kind: "deterministic", state: name };
        }
        if (this.peek()?.type === "semicolon") this.advance();
        continue;
      }

      // State definition: either inline (name = expr: transitions) or reference (ref: transitions)
      let name: string;
      let emission: Expr;

      if (tok.type === "ident" && this.tokens[this.pos + 1]?.type === "assign") {
        // Inline: name = expr
        this.advance(); // consume ident
        this.advance(); // consume =
        name = tok.name;
        emission = this.parseExpression();
      } else {
        ({ name, emission } = this.parseMarkovRef());
      }

      if (this.peek()?.type !== "colon") throw new Error(`Expected ':' after state name '${name}'`);
      this.advance(); // consume ':'

      states.push({ name, emission, transitions: this.parseTransitionList() });

      if (this.peek()?.type === "semicolon") {
        this.advance();
        continue;
      }
    }

    if (this.peek()?.type !== "rparen") throw new Error("Expected ')' after Markov definition");
    this.advance(); // consume ')'

    if (states.length === 0) throw new Error("Markov() requires at least one state");

    const defaultInit: MarkovInit = { kind: "deterministic", state: states[0].name };
    return { type: "markov", states, init: init ?? defaultInit };
  }

  /** Parse a state/target reference: identifier, cell reference, or cross-sheet reference.
   *  Returns a canonical name (for matching transitions) and an Expr node. */
  private parseMarkovRef(): { name: string; emission: Expr } {
    const tok = this.peek();
    if (tok?.type === "ident") {
      this.advance();
      // Cross-sheet: ident.ref
      if (this.peek()?.type === "dot") {
        this.advance(); // consume dot
        const ref = this.parseSheetRef(tok.original);
        return { name: sheetRefLabel(tok.original, ref), emission: ref };
      }
      return { name: tok.name, emission: { type: "varRef", name: tok.name } };
    }
    // Quoted sheet name: 'Sheet Name'.ref
    if (tok?.type === "quotedName") {
      this.advance();
      if (this.peek()?.type !== "dot") throw new Error(`Expected '.' after '${tok.name}'`);
      this.advance(); // consume dot
      const ref = this.parseSheetRef(tok.name);
      return { name: sheetRefLabel(`'${tok.name}'`, ref), emission: ref };
    }
    if (tok?.type === "cellRef") {
      this.advance();
      const addr = toAddress(tok.col, tok.row);
      return {
        name: addr.toLowerCase(),
        emission: {
          type: "cellRef", col: tok.col, row: tok.row,
          ...(tok.pinCol ? { pinCol: true } : {}),
          ...(tok.pinRow ? { pinRow: true } : {}),
        },
      };
    }
    throw new Error("Expected state name (variable or cell reference) in Markov()");
  }

  /** Parse a comma-separated list of transitions: prob -> target, prob -> target */
  private parseTransitionList(): { prob: number; target: string }[] {
    const transitions: { prob: number; target: string }[] = [];
    while (true) {
      const probTok = this.peek();
      if (!probTok || probTok.type !== "number") throw new Error("Expected probability in transition");
      this.advance();

      if (this.peek()?.type !== "arrow") throw new Error("Expected '->' after probability");
      this.advance();

      const { name } = this.parseMarkovRef();
      transitions.push({ prob: probTok.value, target: name });

      if (this.peek()?.type === "comma") {
        this.advance();
        continue;
      }
      break;
    }
    return transitions;
  }

  /** primary = number | cellRef | quotedName '.' ref | ident '.' ref | ident '(' args ')' | ident | '(' expr ')' */
  private parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok) throw new Error("Unexpected end of expression");

    if (tok.type === "number") {
      this.advance();
      return { type: "number", value: tok.value };
    }

    if (tok.type === "cellRef") {
      this.advance();
      return {
        type: "cellRef",
        col: tok.col,
        row: tok.row,
        ...(tok.pinCol ? { pinCol: true } : {}),
        ...(tok.pinRow ? { pinRow: true } : {}),
      };
    }

    // Quoted sheet name: 'Sheet Name'.ref
    if (tok.type === "quotedName") {
      this.advance();
      if (this.peek()?.type !== "dot") {
        throw new Error(`Expected '.' after '${tok.name}'`);
      }
      this.advance(); // consume dot
      return this.parseSheetRef(tok.name);
    }

    if (tok.type === "ident") {
      this.advance();
      // Cross-sheet reference: ident.ref
      if (this.peek()?.type === "dot") {
        this.advance(); // consume dot
        return this.parseSheetRef(tok.original);
      }
      // Function call?
      if (this.peek()?.type === "lparen") {
        this.advance(); // consume '('

        // Special parsing for Markov()
        if (tok.name === "markov") {
          return this.parseMarkovArgs();
        }

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
