/** A cell's evaluated result: either a single number or an array of MC samples */
export type CellResult =
  | { kind: "scalar"; value: number }
  | { kind: "samples"; values: Float64Array };

/** Supported distribution types */
export type Distribution =
  | { type: "Normal"; mean: number; std: number }
  | { type: "LogNormal"; mu: number; sigma: number }
  | { type: "Uniform"; low: number; high: number }
  | { type: "Triangular"; low: number; mode: number; high: number }
  | { type: "Beta"; alpha: number; beta: number };

/** AST node types for parsed formulas */
export type Expr =
  | { type: "number"; value: number }
  | { type: "cellRef"; col: number; row: number } // 0-indexed
  | { type: "varRef"; name: string }
  | { type: "binOp"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr }
  | { type: "unaryMinus"; operand: Expr }
  | { type: "funcCall"; name: string; args: Expr[] };

/** What the user typed into a cell, after parsing */
export type CellContent =
  | { kind: "empty" }
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "distribution"; dist: Distribution }
  | { kind: "formula"; expr: Expr };

/** Full cell state */
export interface Cell {
  raw: string; // what the user typed
  content: CellContent;
  variableName?: string; // if the cell defines a variable (e.g. "income = ...")
  result?: CellResult;
  error?: string;
}

/** Cell address as "A1" style string */
export type CellAddress = string;

/** The full spreadsheet state */
export interface Sheet {
  name: string;
  cells: Map<CellAddress, Cell>;
  numSamples: number;
}

/** Convert 0-indexed col/row to address like "A1" */
export function toAddress(col: number, row: number): CellAddress {
  let colStr = "";
  let c = col;
  do {
    colStr = String.fromCharCode(65 + (c % 26)) + colStr;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return colStr + (row + 1);
}

/** Parse address like "A1" to 0-indexed {col, row} */
export function parseAddress(addr: string): { col: number; row: number } | null {
  const match = addr.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  col -= 1; // to 0-indexed
  const row = parseInt(match[2], 10) - 1;
  return { col, row };
}
