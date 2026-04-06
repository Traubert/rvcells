import type { Cell, CellAddress, CellResult, Expr, MarkovInit, MarkovStateDef, Sheet, WorkbookSettings } from "./types";
import { toAddress, parseAddress } from "./types";
import { sample } from "./distributions";
import { parseCell } from "./parser";
import { DEFAULT_SHEET_NAME, DEFAULT_NUM_SAMPLES, DEFAULT_NUM_HISTOGRAM_BINS, DEFAULT_CHAIN_SEARCH_LIMIT, SAMPLE_CONSTRUCTORS, ID_CONT_SRC, ID_START_SRC } from "../constants";
import type { InlineSample } from "./types";

/** Module-level capture for inline distribution samples during formula evaluation.
 *  Set by evalCell before evaluating a formula, read by evalFunc. */
let _inlineSampleCapture: InlineSample[] | null = null;

/** When true, distribution constructors return their expected value as a scalar
 *  instead of generating random samples. Used by tornado scenario evaluation. */
let _deterministicMode = false;

/** Current cell being evaluated — used by Chain to attach body/initial to the cell. */
let _currentEvalCell: Cell | null = null;

/** Current chain step number — used by _t variable inside chain bodies. */
let _currentChainStep: number | null = null;

/** Global cell address: "sheetIdx:cellAddr" */
type GlobalAddr = string;

function toGlobal(sheetIdx: number, addr: CellAddress): GlobalAddr {
  return `${sheetIdx}:${addr}`;
}

function fromGlobal(ga: GlobalAddr): { sheetIdx: number; addr: CellAddress } {
  const sep = ga.indexOf(":");
  return { sheetIdx: Number(ga.slice(0, sep)), addr: ga.slice(sep + 1) };
}

/** Cross-sheet reference info */
interface SheetRef {
  sheet: string;
  addr?: CellAddress;   // for sheetCellRef
  varName?: string;      // for sheetVarRef
}

/** Collect all cell/variable dependencies from an expression */
function exprDeps(expr: Expr): {
  cellRefs: CellAddress[];
  varRefs: string[];
  sheetRefs: SheetRef[];
} {
  const cellRefs: CellAddress[] = [];
  const varRefs: string[] = [];
  const sheetRefs: SheetRef[] = [];

  function walk(e: Expr) {
    switch (e.type) {
      case "number":
        break;
      case "cellRef":
        cellRefs.push(toAddress(e.col, e.row));
        break;
      case "varRef":
        varRefs.push(e.name);
        break;
      case "sheetCellRef":
        sheetRefs.push({ sheet: e.sheet, addr: toAddress(e.col, e.row) });
        break;
      case "sheetVarRef":
        sheetRefs.push({ sheet: e.sheet, varName: e.name });
        break;
      case "binOp":
        walk(e.left);
        walk(e.right);
        break;
      case "unaryMinus":
        walk(e.operand);
        break;
      case "funcCall":
        e.args.forEach(walk);
        break;
      case "markov":
        // Walk emission references (varRef or cellRef) for dependency tracking
        for (const state of e.states) {
          walk(state.emission);
        }
        break;
      case "cellRange":
        for (let r = e.startRow; r <= e.endRow; r++)
          for (let c = e.startCol; c <= e.endCol; c++)
            cellRefs.push(toAddress(c, r));
        break;
      case "chainRange":
        walk(e.target);
        walk(e.start);
        walk(e.end);
        break;
      case "chainStep":
        walk(e.target);
        walk(e.step);
        break;
    }
  }
  walk(expr);
  return { cellRefs, varRefs, sheetRefs };
}

/** Convert text to a valid variable name: lowercase, spaces/hyphens to underscores */
function textToVarName(text: string): string | undefined {
  const name = text.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
  if (!name || /^\p{N}/u.test(name)) return undefined;
  return name;
}

/**
 * Resolve labelVar cells: for cells with labelVar=true, derive the variable
 * name from the text cell immediately to the left. Updates cell.variableName.
 */
function resolveLabelVars(cells: Map<CellAddress, Cell>): void {
  for (const [addr, cell] of cells) {
    if (!cell.labelVar) continue;
    // Find the cell to the left
    const parsed = parseAddress(addr);
    if (!parsed || parsed.col === 0) {
      cell.variableName = undefined;
      continue;
    }
    const leftAddr = toAddress(parsed.col - 1, parsed.row);
    const leftCell = cells.get(leftAddr);
    if (leftCell?.content.kind === "text") {
      cell.variableName = textToVarName(leftCell.content.value);
    } else {
      cell.variableName = undefined;
    }
  }
}

/** Build a map from variable name → cell address.
 *  First definition wins; subsequent duplicates get marked with errors.
 *  Returns the varMap and the set of duplicate cell addresses. */
function buildVarMap(cells: Map<CellAddress, Cell>): { varMap: Map<string, CellAddress>; dupAddrs: Set<CellAddress>; clearedAddrs: CellAddress[] } {
  resolveLabelVars(cells);
  // Clear previous duplicate errors so they can be re-evaluated
  const clearedAddrs: CellAddress[] = [];
  for (const [addr, cell] of cells) {
    if (cell.variableName && (cell.error?.startsWith("Duplicate variable") || cell.error?.includes("reserved name"))) {
      cell.error = undefined;
      clearedAddrs.push(addr);
    }
  }
  const varMap = new Map<string, CellAddress>();
  const dupAddrs = new Set<CellAddress>();
  const RESERVED_VARS = new Set(["_t"]);
  for (const [addr, cell] of cells) {
    if (cell.variableName) {
      if (RESERVED_VARS.has(cell.variableName)) {
        cell.error = `"${cell.variableName}" is a reserved name`;
        cell.result = undefined;
        dupAddrs.add(addr);
      } else {
        const existing = varMap.get(cell.variableName);
        if (existing) {
          cell.error = `Duplicate variable "${cell.variableName}" (already defined in ${existing})`;
          cell.result = undefined;
          dupAddrs.add(addr);
        } else {
          varMap.set(cell.variableName, addr);
        }
      }
    }
  }
  // Only report cleared addrs that are truly cleared (not re-marked as duplicate)
  return { varMap, dupAddrs, clearedAddrs: clearedAddrs.filter(a => !dupAddrs.has(a)) };
}

/** Find sheet index by name (case-insensitive) */
function findSheetIndex(allSheets: Sheet[], name: string): number {
  const lower = name.toLowerCase();
  return allSheets.findIndex((s) => s.name.toLowerCase() === lower);
}

/** Cross-sheet evaluation context */
interface CrossSheetCtx {
  allSheets: Sheet[];
  currentSheetIdx: number;
  allVarMaps: Map<string, CellAddress>[];
  allResults: Map<CellAddress, CellResult>[];
  settings: WorkbookSettings;
}

/** Check if a cell's formula is a Chain() or Markov() call */
function isChainCell(cell: Cell): boolean {
  if (cell.content.kind !== "formula") return false;
  const expr = cell.content.expr;
  return (expr.type === "funcCall" && expr.name === "chain") || expr.type === "markov";
}

/** Get all direct dependencies of a cell as cell addresses (local only) */
function cellDeps(cell: Cell, varMap: Map<string, CellAddress>, cellAddr?: CellAddress): CellAddress[] {
  if (cell.content.kind !== "formula") return [];
  const isChain = isChainCell(cell);
  const { cellRefs, varRefs } = exprDeps(cell.content.expr);
  const deps: CellAddress[] = [];
  for (const ref of cellRefs) {
    if (isChain && ref === cellAddr) continue; // chain self-reference by address
    deps.push(ref);
  }
  const selfVar = isChain ? cell.variableName : undefined;
  for (const v of varRefs) {
    if (v === selfVar) continue; // chain self-reference by variable name
    const addr = varMap.get(v);
    if (addr) deps.push(addr);
  }
  return deps;
}

/** Get all direct dependencies of a cell as global addresses (cross-sheet aware) */
function globalCellDeps(
  cell: Cell,
  cellAddr: CellAddress,
  sheetIdx: number,
  allSheets: Sheet[],
  allVarMaps: Map<string, CellAddress>[],
): GlobalAddr[] {
  if (cell.content.kind !== "formula") return [];
  const isChain = isChainCell(cell);
  const { cellRefs, varRefs, sheetRefs } = exprDeps(cell.content.expr);
  const deps: GlobalAddr[] = [];

  // Local cell refs
  for (const addr of cellRefs) {
    if (isChain && addr === cellAddr) continue; // chain self-reference by address
    deps.push(toGlobal(sheetIdx, addr));
  }
  // Local var refs
  const varMap = allVarMaps[sheetIdx];
  const selfVar = isChain ? cell.variableName : undefined;
  for (const v of varRefs) {
    if (v === selfVar) continue; // chain self-reference by variable name
    const addr = varMap.get(v);
    if (addr) deps.push(toGlobal(sheetIdx, addr));
  }
  // Cross-sheet refs
  for (const ref of sheetRefs) {
    const targetIdx = findSheetIndex(allSheets, ref.sheet);
    if (targetIdx < 0) continue; // unknown sheet — will error at eval time
    if (ref.addr) {
      deps.push(toGlobal(targetIdx, ref.addr));
    } else if (ref.varName) {
      const addr = allVarMaps[targetIdx].get(ref.varName);
      if (addr) deps.push(toGlobal(targetIdx, addr));
    }
  }
  return deps;
}


/** Apply a binary operation elementwise, handling scalar/samples mixing */
function binOp(
  op: "+" | "-" | "*" | "/" | "==" | "!=" | ">" | "<" | ">=" | "<=",
  a: CellResult,
  b: CellResult,
  n: number
): CellResult {
  // Both scalar
  if (a.kind === "scalar" && b.kind === "scalar") {
    switch (op) {
      case "+":  return { kind: "scalar", value: a.value + b.value };
      case "-":  return { kind: "scalar", value: a.value - b.value };
      case "*":  return { kind: "scalar", value: a.value * b.value };
      case "/":  return { kind: "scalar", value: a.value / b.value };
      case "==": return { kind: "scalar", value: a.value === b.value ? 1 : 0 };
      case "!=": return { kind: "scalar", value: a.value !== b.value ? 1 : 0 };
      case ">":  return { kind: "scalar", value: a.value > b.value ? 1 : 0 };
      case "<":  return { kind: "scalar", value: a.value < b.value ? 1 : 0 };
      case ">=": return { kind: "scalar", value: a.value >= b.value ? 1 : 0 };
      case "<=": return { kind: "scalar", value: a.value <= b.value ? 1 : 0 };
    }
  }

  // At least one is samples — promote both to arrays
  const aArr = a.kind === "samples" ? a.values : broadcastScalar(a.value, n);
  const bArr = b.kind === "samples" ? b.values : broadcastScalar(b.value, n);
  const out = new Float64Array(n);

  switch (op) {
    case "+":  for (let i = 0; i < n; i++) out[i] = aArr[i] + bArr[i]; break;
    case "-":  for (let i = 0; i < n; i++) out[i] = aArr[i] - bArr[i]; break;
    case "*":  for (let i = 0; i < n; i++) out[i] = aArr[i] * bArr[i]; break;
    case "/":  for (let i = 0; i < n; i++) out[i] = aArr[i] / bArr[i]; break;
    case "==": for (let i = 0; i < n; i++) out[i] = aArr[i] === bArr[i] ? 1 : 0; break;
    case "!=": for (let i = 0; i < n; i++) out[i] = aArr[i] !== bArr[i] ? 1 : 0; break;
    case ">":  for (let i = 0; i < n; i++) out[i] = aArr[i] > bArr[i] ? 1 : 0; break;
    case "<":  for (let i = 0; i < n; i++) out[i] = aArr[i] < bArr[i] ? 1 : 0; break;
    case ">=": for (let i = 0; i < n; i++) out[i] = aArr[i] >= bArr[i] ? 1 : 0; break;
    case "<=": for (let i = 0; i < n; i++) out[i] = aArr[i] <= bArr[i] ? 1 : 0; break;
  }

  return { kind: "samples", values: out };
}

function broadcastScalar(value: number, n: number): Float64Array {
  const arr = new Float64Array(n);
  arr.fill(value);
  return arr;
}

/** Evaluate an expression given resolved cell results */
function evalExpr(
  expr: Expr,
  results: Map<CellAddress, CellResult>,
  varMap: Map<string, CellAddress>,
  n: number,
  cells: Map<CellAddress, Cell>,
  ctx?: CrossSheetCtx,
): CellResult {
  switch (expr.type) {
    case "number":
      return { kind: "scalar", value: expr.value };

    case "cellRef": {
      const addr = toAddress(expr.col, expr.row);
      return results.get(addr) ?? { kind: "scalar", value: 0 };
    }

    case "varRef": {
      // _t is a contextual variable inside chain bodies
      if (expr.name === "_t" && _currentChainStep !== null) {
        return { kind: "scalar", value: _currentChainStep };
      }
      const addr = varMap.get(expr.name);
      if (!addr) throw new Error(`Unknown variable: ${expr.name}`);
      return results.get(addr) ?? { kind: "scalar", value: 0 };
    }

    case "sheetCellRef": {
      if (!ctx) throw new Error("Cross-sheet references require multi-sheet context");
      const targetIdx = findSheetIndex(ctx.allSheets, expr.sheet);
      if (targetIdx < 0) throw new Error(`Unknown sheet: ${expr.sheet}`);
      const addr = toAddress(expr.col, expr.row);
      return ctx.allResults[targetIdx].get(addr) ?? { kind: "scalar", value: 0 };
    }

    case "sheetVarRef": {
      if (!ctx) throw new Error("Cross-sheet references require multi-sheet context");
      const targetIdx = findSheetIndex(ctx.allSheets, expr.sheet);
      if (targetIdx < 0) throw new Error(`Unknown sheet: ${expr.sheet}`);
      const targetVarMap = ctx.allVarMaps[targetIdx];
      const addr = targetVarMap.get(expr.name);
      if (!addr) throw new Error(`Unknown variable "${expr.name}" in sheet "${expr.sheet}"`);
      return ctx.allResults[targetIdx].get(addr) ?? { kind: "scalar", value: 0 };
    }

    case "binOp": {
      const left = evalExpr(expr.left, results, varMap, n, cells, ctx);
      const right = evalExpr(expr.right, results, varMap, n, cells, ctx);
      return binOp(expr.op, left, right, n);
    }

    case "unaryMinus": {
      const operand = evalExpr(expr.operand, results, varMap, n, cells, ctx);
      if (operand.kind === "scalar") {
        return { kind: "scalar", value: -operand.value };
      }
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = -operand.values[i];
      return { kind: "samples", values: out };
    }

    case "funcCall":
      return evalFunc(expr.name, expr.args, results, varMap, n, cells, ctx);

    case "markov": {
      const selfVar = _currentEvalCell?.variableName;
      if (!selfVar) throw new Error("Markov() must be assigned to a named variable");
      const selfAddr = varMap.get(selfVar);
      if (!selfAddr) throw new Error("Markov() variable not found in varMap");

      // Compile transition matrix and validate state references
      const { stateNames, transitions } = compileMarkovDef(expr.states, expr.init);

      for (const state of expr.states) {
        if (state.emission.type === "varRef") {
          if (!varMap.get(state.emission.name))
            throw new Error(`Unknown variable '${state.emission.name}' in Markov state '${state.name}'`);
        } else if (state.emission.type === "cellRef") {
          const addr = toAddress(state.emission.col, state.emission.row);
          if (!cells.has(addr))
            throw new Error(`Empty cell ${addr} referenced in Markov state '${state.name}'`);
        }
      }

      // Compile to Chain-compatible Expr trees
      const stateBody = compileMarkovStateBody(selfVar, transitions);
      const emissionBody = compileMarkovEmissionBody(selfVar, expr.states);
      const initExpr = compileMarkovInit(expr.init, stateNames);

      // Evaluate initial state (scalar for deterministic, samples for Discrete)
      const initStateResult = evalExpr(initExpr, results, varMap, n, cells, ctx);
      const initialStates = toArray(initStateResult, n);

      // Evaluate initial emission by injecting initial state as self-reference
      const shadowResults = new Map(results);
      shadowResults.set(selfAddr, { kind: "samples", values: initialStates });
      const initialEmission = evalExpr(emissionBody, shadowResults, varMap, n, cells, ctx);

      // Store as Chain metadata — reuses Chain infrastructure for timeline/ChainIndex
      if (_currentEvalCell) {
        _currentEvalCell.chainBody = emissionBody;
        _currentEvalCell.chainInitial = initialEmission;
        _currentEvalCell.chainCache = undefined;
        _currentEvalCell.markovDef = { stateBody, initialStates };
        _currentEvalCell.markovStateCache = undefined;
      }

      return initialEmission;
    }

    case "chainStep": {
      // Resolve chain cell from target expression
      const target = expr.target;
      let targetAddr: CellAddress;
      let targetCells = cells;
      let targetResults = results;
      let targetVarMap = varMap;
      if (target.type === "cellRef") {
        targetAddr = toAddress(target.col, target.row);
      } else if (target.type === "varRef") {
        const resolved = varMap.get(target.name);
        if (!resolved) throw new Error(`Unknown variable: ${target.name}`);
        targetAddr = resolved;
      } else if ((target.type === "sheetVarRef" || target.type === "sheetCellRef") && ctx) {
        const targetIdx = findSheetIndex(ctx.allSheets, target.sheet);
        if (targetIdx < 0) throw new Error(`Unknown sheet: ${target.sheet}`);
        if (target.type === "sheetVarRef") {
          const addr = ctx.allVarMaps[targetIdx].get(target.name);
          if (!addr) throw new Error(`Unknown variable "${target.name}" in sheet "${target.sheet}"`);
          targetAddr = addr;
        } else {
          targetAddr = toAddress(target.col, target.row);
        }
        targetCells = ctx.allSheets[targetIdx].cells;
        targetResults = ctx.allResults[targetIdx];
        targetVarMap = ctx.allVarMaps[targetIdx];
      } else {
        throw new Error("Chain step target must be a cell reference or variable");
      }
      const targetCell = targetCells.get(targetAddr);
      if (!targetCell?.chainBody) throw new Error("Bracket index requires a Chain cell");
      const stepResult = evalExpr(expr.step, results, varMap, n, cells, ctx);
      if (stepResult.kind !== "scalar") throw new Error("Chain step must be a scalar");
      const step = Math.floor(stepResult.value);
      if (step < 0) throw new Error("Chain step must be non-negative");
      const values = evaluateChainStep(targetCell, targetAddr, step, targetResults, targetVarMap, n, targetCells, ctx);
      return { kind: "samples", values };
    }

    case "cellRange":
      throw new Error("Cell ranges (A1:B10) can only be used inside function arguments");

    case "chainRange":
      throw new Error("Chain ranges (x[0:10]) can only be used inside function arguments");
  }
}

/** Convert a CellResult to a Float64Array, broadcasting scalars */
function toArray(r: CellResult, n: number): Float64Array {
  if (r.kind === "samples") return r.values;
  return broadcastScalar(r.value, n);
}

/** Check if any of the results are sample arrays */
function anySamples(args: CellResult[]): boolean {
  return args.some((a) => a.kind === "samples");
}

/** Apply a function elementwise over one or more arguments */
function applyElementwise(
  args: CellResult[],
  scalarFn: (...vals: number[]) => number,
  n: number
): CellResult {
  if (!anySamples(args)) {
    return { kind: "scalar", value: scalarFn(...args.map((a) => (a as { kind: "scalar"; value: number }).value)) };
  }
  const arrays = args.map((a) => toArray(a, n));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = scalarFn(...arrays.map((arr) => arr[i]));
  }
  return { kind: "samples", values: out };
}

/**
 * Collect the transitive sub-DAG rooted at `addr` (the cell itself + all its
 * dependencies, recursively). Returns addresses in topological order
 * (deepest dependencies first).
 */
function collectSubDag(
  addr: CellAddress,
  cells: Map<CellAddress, Cell>,
  varMap: Map<string, CellAddress>
): CellAddress[] {
  const order: CellAddress[] = [];
  const visited = new Set<CellAddress>();

  function visit(a: CellAddress) {
    if (visited.has(a)) return;
    visited.add(a);
    const cell = cells.get(a);
    if (cell) {
      for (const dep of cellDeps(cell, varMap, a)) {
        visit(dep);
      }
    }
    order.push(a);
  }

  visit(addr);
  return order;
}

/** Capture inline distribution samples for sensitivity analysis.
 *  In deterministic mode, returns the expected value as a scalar instead. */
function captureDist(label: string, result: CellResult, expectedValue?: number): CellResult {
  if (_deterministicMode && expectedValue !== undefined) {
    return { kind: "scalar", value: expectedValue };
  }
  if (_inlineSampleCapture && result.kind === "samples") {
    _inlineSampleCapture.push({ label, values: result.values });
  }
  return result;
}

// ─── Markov compilation ──────────────────────────────────────────────

/**
 * Compile a Markov definition into a normalized transition matrix.
 * Missing probability mass is assigned to self-transitions; rows are normalized.
 */
function compileMarkovDef(
  states: MarkovStateDef[],
  init: MarkovInit,
): { stateNames: string[]; transitions: number[][] } {
  const stateNames = states.map(s => s.name);
  const stateIndex = new Map(stateNames.map((n, i) => [n, i]));
  const N = stateNames.length;

  // Validate init references
  if (init.kind === "deterministic") {
    if (!stateIndex.has(init.state)) throw new Error(`Unknown initial state '${init.state}'`);
  } else {
    for (const { target } of init.transitions) {
      if (!stateIndex.has(target)) throw new Error(`Unknown state '${target}' in Markov init`);
    }
  }

  const transitions: number[][] = [];
  for (let from = 0; from < N; from++) {
    const row = new Array(N).fill(0);
    for (const { prob, target } of states[from].transitions) {
      const to = stateIndex.get(target);
      if (to === undefined) throw new Error(`Unknown state '${target}' in Markov transition`);
      row[to] += prob;
    }
    // Assign remaining mass to self-transition
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum <= 0) throw new Error(`State '${stateNames[from]}' has no transition probability`);
    row[from] += Math.max(0, 1 - sum);
    // Normalize
    const total = row.reduce((a, b) => a + b, 0);
    for (let j = 0; j < N; j++) row[j] /= total;
    transitions.push(row);
  }

  return { stateNames, transitions };
}

/**
 * Compile the initial state into an Expr that evaluates to a state index.
 * Deterministic: just a number literal. Probabilistic: Discrete() call.
 */
function compileMarkovInit(init: MarkovInit, stateNames: string[]): Expr {
  const stateIndex = new Map(stateNames.map((name, i) => [name, i]));
  if (init.kind === "deterministic") {
    return { type: "number", value: stateIndex.get(init.state)! };
  }
  // Probabilistic: build Discrete(p0, p1, ..., pN) with probs in state order
  const probs = new Array(stateNames.length).fill(0);
  for (const { prob, target } of init.transitions) {
    probs[stateIndex.get(target)!] += prob;
  }
  return {
    type: "funcCall",
    name: "discrete",
    args: probs.map(p => ({ type: "number" as const, value: p })),
  };
}

/**
 * Build a nested if-chain expression for selecting among N alternatives by state index.
 * if(self == 0, bodies[0], if(self == 1, bodies[1], ... bodies[N-1]))
 * Uses the cell's self-variable reference so it works with Chain's shadowResults mechanism.
 */
function buildStateSwitch(selfName: string, bodies: Expr[]): Expr {
  if (bodies.length === 1) return bodies[0];
  // Build from the end: the last state is the else branch
  let result: Expr = bodies[bodies.length - 1];
  for (let i = bodies.length - 2; i >= 0; i--) {
    result = {
      type: "funcCall",
      name: "if",
      args: [
        { type: "binOp", op: "==", left: { type: "varRef", name: selfName }, right: { type: "number", value: i } },
        bodies[i],
        result,
      ],
    };
  }
  return result;
}

/**
 * Compile the state transition body from a Markov transition matrix.
 * Produces: if(self == 0, Discrete(row0...), if(self == 1, Discrete(row1...), ...))
 */
function compileMarkovStateBody(selfName: string, transitions: number[][]): Expr {
  const bodies = transitions.map(row => ({
    type: "funcCall" as const,
    name: "discrete",
    args: row.map(p => ({ type: "number" as const, value: p })),
  }));
  return buildStateSwitch(selfName, bodies);
}

/**
 * Compile the emission body from state definitions.
 * Produces: if(self == 0, emission0, if(self == 1, emission1, emission2))
 */
function compileMarkovEmissionBody(selfName: string, states: MarkovStateDef[]): Expr {
  return buildStateSwitch(selfName, states.map(s => s.emission));
}

/** Lazily compute chain steps up to targetStep, caching results.
 *  Referenced distribution cells are auto-resampled each step.
 *  Referenced chain cells are auto-synced to the same step. */
function evaluateChainStep(
  chainCell: Cell,
  chainAddr: CellAddress,
  targetStep: number,
  results: Map<CellAddress, CellResult>,
  varMap: Map<string, CellAddress>,
  n: number,
  cells: Map<CellAddress, Cell>,
  ctx?: CrossSheetCtx,
): Float64Array {
  if (!chainCell.chainBody || !chainCell.chainInitial) {
    throw new Error("Not a chain cell");
  }

  const isMarkov = !!chainCell.markovDef;

  // Initialize caches with initial values
  if (!chainCell.chainCache) {
    chainCell.chainCache = [toArray(chainCell.chainInitial, n)];
  }
  if (isMarkov && !chainCell.markovStateCache) {
    chainCell.markovStateCache = [chainCell.markovDef!.initialStates];
  }

  if (targetStep < chainCell.chainCache.length) {
    return chainCell.chainCache[targetStep];
  }

  // Collect body dependencies for auto-resample/auto-sync
  const { cellRefs, varRefs } = exprDeps(chainCell.chainBody);
  const depAddrs: CellAddress[] = [];
  for (const ref of cellRefs) {
    if (ref === chainAddr) continue; // self-ref by address handled via shadow results
    depAddrs.push(ref);
  }
  for (const v of varRefs) {
    if (v === chainCell.variableName) continue; // self-ref by variable name
    const addr = varMap.get(v);
    if (addr) depAddrs.push(addr);
  }

  // Classify deps: chain cells vs non-chain cells
  const chainDeps: { addr: CellAddress; cell: Cell }[] = [];
  const resampleDeps: CellAddress[] = [];
  for (const addr of depAddrs) {
    const depCell = cells.get(addr);
    if (depCell && isChainCell(depCell)) {
      chainDeps.push({ addr, cell: depCell });
    } else {
      resampleDeps.push(addr);
    }
  }

  // Collect sub-DAGs for non-chain deps (for resampling)
  const resampleSubDags = resampleDeps.map((addr) => ({
    addr,
    subDag: collectSubDag(addr, cells, varMap),
  }));

  for (let t = chainCell.chainCache.length; t <= targetStep; t++) {
    // Save/restore chain step for nested chains
    const prevChainStep = _currentChainStep;
    _currentChainStep = t;

    // Build shadow results with resampled deps and synced chains
    const shadowResults = new Map(results);

    // Auto-resample non-chain deps (fresh draws each step)
    for (const { addr, subDag } of resampleSubDags) {
      const freshResults = new Map<CellAddress, CellResult>();
      for (const subAddr of subDag) {
        const subCell = cells.get(subAddr);
        if (subCell) {
          evalCell(subAddr, subCell, freshResults, varMap, n, cells, true, ctx);
        }
      }
      const freshResult = freshResults.get(addr);
      if (freshResult) shadowResults.set(addr, freshResult);
    }

    // Auto-sync chain deps to current step
    for (const { addr, cell } of chainDeps) {
      const stepValues = evaluateChainStep(cell, addr, t, results, varMap, n, cells, ctx);
      shadowResults.set(addr, { kind: "samples", values: stepValues });
    }

    if (isMarkov) {
      // Markov: two-phase evaluation wrapping two internal Chains
      // Phase 1 — state transition: self-ref = previous state
      shadowResults.set(chainAddr, { kind: "samples", values: chainCell.markovStateCache![t - 1] });
      const newState = evalExpr(chainCell.markovDef!.stateBody, shadowResults, varMap, n, cells, ctx);
      chainCell.markovStateCache![t] = toArray(newState, n);

      // Phase 2 — emission: self-ref = new state (so emission body selects correct distribution)
      shadowResults.set(chainAddr, { kind: "samples", values: chainCell.markovStateCache![t] });
      const emission = evalExpr(chainCell.chainBody, shadowResults, varMap, n, cells, ctx);
      chainCell.chainCache[t] = toArray(emission, n);
    } else {
      // Regular Chain: self-ref = previous step's value
      shadowResults.set(chainAddr, { kind: "samples", values: chainCell.chainCache[t - 1] });
      const stepResult = evalExpr(chainCell.chainBody, shadowResults, varMap, n, cells, ctx);
      chainCell.chainCache[t] = toArray(stepResult, n);
    }

    _currentChainStep = prevChainStep;
  }

  return chainCell.chainCache[targetStep];
}

/**
 * Expand function arguments, resolving cell ranges and chain ranges into lists of CellResult.
 * Returns the expanded values and whether any argument was a range (for arity disambiguation).
 */
function expandArgs(
  argExprs: Expr[],
  results: Map<CellAddress, CellResult>,
  varMap: Map<string, CellAddress>,
  n: number,
  cells: Map<CellAddress, Cell>,
  ctx?: CrossSheetCtx,
): { values: CellResult[]; hasRange: boolean } {
  const values: CellResult[] = [];
  let hasRange = false;

  for (const e of argExprs) {
    if (e.type === "cellRange") {
      hasRange = true;
      for (let r = e.startRow; r <= e.endRow; r++)
        for (let c = e.startCol; c <= e.endCol; c++) {
          const addr = toAddress(c, r);
          values.push(results.get(addr) ?? { kind: "scalar", value: 0 });
        }
    } else if (e.type === "chainRange") {
      hasRange = true;
      // Resolve chain cell
      const target = e.target;
      let targetAddr: CellAddress;
      if (target.type === "cellRef") {
        targetAddr = toAddress(target.col, target.row);
      } else if (target.type === "varRef") {
        const resolved = varMap.get(target.name);
        if (!resolved) throw new Error(`Unknown variable: ${target.name}`);
        targetAddr = resolved;
      } else if (target.type === "sheetVarRef" || target.type === "sheetCellRef") {
        // Cross-sheet: resolve via context
        if (!ctx) throw new Error("Cross-sheet chain ranges require multi-sheet context");
        const targetIdx = findSheetIndex(ctx.allSheets, target.type === "sheetVarRef" ? target.sheet : target.sheet);
        if (targetIdx < 0) throw new Error(`Unknown sheet: ${target.sheet}`);
        if (target.type === "sheetVarRef") {
          const addr = ctx.allVarMaps[targetIdx].get(target.name);
          if (!addr) throw new Error(`Unknown variable "${target.name}" in sheet "${target.sheet}"`);
          targetAddr = addr;
        } else {
          targetAddr = toAddress(target.col, target.row);
        }
        // For cross-sheet chains, use that sheet's cells
        const targetCell = ctx.allSheets[targetIdx].cells.get(targetAddr);
        if (!targetCell?.chainBody) throw new Error("Chain range target must be a Chain or Markov cell");
        const startResult = evalExpr(e.start, results, varMap, n, cells, ctx);
        const endResult = evalExpr(e.end, results, varMap, n, cells, ctx);
        if (startResult.kind !== "scalar" || endResult.kind !== "scalar")
          throw new Error("Chain range indices must be scalars");
        const start = Math.floor(startResult.value);
        const end = Math.floor(endResult.value);
        if (start < 0 || end < start) throw new Error("Invalid chain range");
        const targetResults = ctx.allResults[targetIdx];
        const targetVarMap = ctx.allVarMaps[targetIdx];
        const targetCells = ctx.allSheets[targetIdx].cells;
        for (let s = start; s <= end; s++) {
          const stepValues = evaluateChainStep(targetCell, targetAddr, s, targetResults, targetVarMap, n, targetCells, ctx);
          values.push({ kind: "samples", values: stepValues });
        }
        continue;
      } else {
        throw new Error("Chain range target must be a cell reference or variable");
      }
      const targetCell = cells.get(targetAddr);
      if (!targetCell?.chainBody) throw new Error("Chain range target must be a Chain or Markov cell");
      const startResult = evalExpr(e.start, results, varMap, n, cells, ctx);
      const endResult = evalExpr(e.end, results, varMap, n, cells, ctx);
      if (startResult.kind !== "scalar" || endResult.kind !== "scalar")
        throw new Error("Chain range indices must be scalars");
      const start = Math.floor(startResult.value);
      const end = Math.floor(endResult.value);
      if (start < 0 || end < start) throw new Error("Invalid chain range");
      for (let s = start; s <= end; s++) {
        const stepValues = evaluateChainStep(targetCell, targetAddr, s, results, varMap, n, cells, ctx);
        values.push({ kind: "samples", values: stepValues });
      }
    } else {
      values.push(evalExpr(e, results, varMap, n, cells, ctx));
    }
  }

  return { values, hasRange };
}

/** Compute a percentile value from a sample array. Percentile is 0-100.
 *  Interpolates between adjacent samples when the index is fractional. */
function samplePercentile(values: Float64Array, percentile: number): number {
  const sorted = Float64Array.from(values).sort();
  const idx = (percentile / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  if (lo >= sorted.length - 1) return sorted[sorted.length - 1];
  const frac = idx - lo;
  return sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]);
}

/** Elementwise reduce across multiple CellResults */
function reduceElementwise(
  vals: CellResult[], fn: (a: number, b: number) => number, n: number,
): CellResult {
  if (vals.length === 0) throw new Error("Cannot reduce empty list");
  if (vals.length === 1) return vals[0];
  // Check if all scalar
  if (vals.every(v => v.kind === "scalar")) {
    let acc = (vals[0] as { kind: "scalar"; value: number }).value;
    for (let i = 1; i < vals.length; i++) acc = fn(acc, (vals[i] as { kind: "scalar"; value: number }).value);
    return { kind: "scalar", value: acc };
  }
  // At least one is samples — promote all to arrays and reduce
  let acc = toArray(vals[0], n);
  for (let v = 1; v < vals.length; v++) {
    const arr = toArray(vals[v], n);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = fn(acc[i], arr[i]);
    acc = out;
  }
  return { kind: "samples", values: acc };
}

/** Evaluate a function call */
function evalFunc(
  name: string,
  argExprs: Expr[],
  results: Map<CellAddress, CellResult>,
  varMap: Map<string, CellAddress>,
  n: number,
  cells: Map<CellAddress, Cell>,
  ctx?: CrossSheetCtx,
): CellResult {
  // resample() is special — it doesn't evaluate its argument normally
  if (name === "resample") {
    if (argExprs.length !== 1) throw new Error("resample(cell) takes 1 argument");
    const arg = argExprs[0];
    // Resolve the target cell address
    let targetAddr: CellAddress;
    if (arg.type === "cellRef") {
      targetAddr = toAddress(arg.col, arg.row);
    } else if (arg.type === "varRef") {
      const resolved = varMap.get(arg.name);
      if (!resolved) throw new Error(`Unknown variable: ${arg.name}`);
      targetAddr = resolved;
    } else {
      throw new Error("resample() argument must be a cell reference or variable");
    }
    // Collect the sub-DAG and re-evaluate it with fresh samples
    const subDag = collectSubDag(targetAddr, cells, varMap);
    const freshResults = new Map<CellAddress, CellResult>();
    for (const subAddr of subDag) {
      const subCell = cells.get(subAddr);
      if (subCell) {
        evalCell(subAddr, subCell, freshResults, varMap, n, cells, true, ctx);
      }
    }
    return freshResults.get(targetAddr) ?? { kind: "scalar", value: 0 };
  }

  // Chain(body, initial) — define an iterative process
  if (name === "chain") {
    if (argExprs.length !== 2) throw new Error("Chain(body, initial) takes 2 arguments");
    // Evaluate the initial value (can be scalar or distribution)
    const initResult = evalExpr(argExprs[1], results, varMap, n, cells, ctx);
    // Validate body references before storing
    const bodyDeps = exprDeps(argExprs[0]);
    const selfVar = _currentEvalCell?.variableName;
    for (const v of bodyDeps.varRefs) {
      if (v === selfVar || v === "_t") continue;
      if (!varMap.get(v)) throw new Error(`Unknown variable in Chain body: ${v}`);
    }
    // Store chain metadata on the cell for lazy step computation
    if (_currentEvalCell) {
      _currentEvalCell.chainBody = argExprs[0];
      _currentEvalCell.chainInitial = initResult;
      _currentEvalCell.chainCache = undefined; // clear cache on re-eval
    }
    return initResult; // direct references to chain cell get the initial value
  }

  // ChainIndex(chain, condition) — find first step where condition is true
  if (name === "chainindex") {
    if (argExprs.length !== 2) throw new Error("ChainIndex(chain, condition) takes 2 arguments");
    // Resolve chain cell
    const arg = argExprs[0];
    let targetAddr: CellAddress;
    if (arg.type === "cellRef") {
      targetAddr = toAddress(arg.col, arg.row);
    } else if (arg.type === "varRef") {
      const resolved = varMap.get(arg.name);
      if (!resolved) throw new Error(`Unknown variable: ${arg.name}`);
      targetAddr = resolved;
    } else {
      throw new Error("ChainIndex() first argument must be a cell reference or variable");
    }
    const targetCell = cells.get(targetAddr);
    if (!targetCell || !targetCell.chainBody) {
      throw new Error("ChainIndex() first argument must be a Chain cell");
    }
    const limit = ctx?.settings?.chainSearchLimit ?? DEFAULT_CHAIN_SEARCH_LIMIT;
    const conditionExpr = argExprs[1];
    // Search: evaluate condition at each step with chain mapped to that step's distribution
    for (let step = 0; step <= limit; step++) {
      const stepValues = evaluateChainStep(targetCell, targetAddr, step, results, varMap, n, cells, ctx);
      const shadowResults = new Map(results);
      shadowResults.set(targetAddr, { kind: "samples", values: stepValues });
      const condResult = evalExpr(conditionExpr, shadowResults, varMap, n, cells, ctx);
      if (condResult.kind === "samples") {
        throw new Error("ChainIndex() condition must evaluate to a scalar (use mean(), P(), min(), max(), etc.)");
      }
      if (condResult.value > 0) {
        return { kind: "scalar", value: step };
      }
    }
    throw new Error(`ChainIndex: search limit (${limit}) exceeded — condition never became true`);
  }

  // ─── Aggregate functions (support ranges and arity-based disambiguation) ──

  // Helper for collapse: single distribution → scalar statistic
  const isCollapseCall = (name: string) =>
    ["sum", "product", "mean", "median", "geomean", "min", "max"].includes(name);

  if (isCollapseCall(name) || name === "p") {
    // P() is always collapse — handle separately
    if (name === "p") {
      const args = argExprs.map(e => evalExpr(e, results, varMap, n, cells, ctx));
      if (args.length !== 2) throw new Error("P(dist, percentile) takes 2 arguments");
      if (args[1].kind !== "scalar") throw new Error("P() percentile must be a scalar");
      if (args[0].kind === "scalar") return args[0]; // P of scalar = itself
      return { kind: "scalar", value: samplePercentile(args[0].values, args[1].value) };
    }

    const { values, hasRange } = expandArgs(argExprs, results, varMap, n, cells, ctx);
    if (values.length === 0) throw new Error(`${name}() requires at least 1 argument`);

    const isAggregate = hasRange || values.length > 1;

    switch (name) {
      case "sum":
        if (!isAggregate) return values[0]; // identity
        return reduceElementwise(values, (a, b) => a + b, n);

      case "product":
        if (!isAggregate) return values[0]; // identity
        return reduceElementwise(values, (a, b) => a * b, n);

      case "mean": {
        if (!isAggregate && values[0].kind === "samples") {
          // Collapse: expected value
          const arr = values[0].values;
          let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i];
          return { kind: "scalar", value: s / arr.length };
        }
        if (!isAggregate) return values[0]; // scalar identity
        const sum = reduceElementwise(values, (a, b) => a + b, n);
        return binOp("/", sum, { kind: "scalar", value: values.length }, n);
      }

      case "median": {
        if (!isAggregate && values[0].kind === "samples") {
          return { kind: "scalar", value: samplePercentile(values[0].values, 50) };
        }
        if (!isAggregate) return values[0];
        // All scalar → scalar median
        if (values.every(v => v.kind === "scalar")) {
          const sorted = Float64Array.from(values.map(v => (v as { kind: "scalar"; value: number }).value)).sort();
          const k = sorted.length;
          return { kind: "scalar", value: k % 2 ? sorted[k >> 1] : (sorted[(k >> 1) - 1] + sorted[k >> 1]) / 2 };
        }
        // Elementwise median across K values
        const arrays = values.map(v => toArray(v, n));
        const k = arrays.length;
        const out = new Float64Array(n);
        const buf = new Float64Array(k);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < k; j++) buf[j] = arrays[j][i];
          buf.sort();
          out[i] = k % 2 ? buf[k >> 1] : (buf[(k >> 1) - 1] + buf[k >> 1]) / 2;
        }
        return { kind: "samples", values: out };
      }

      case "geomean": {
        if (!isAggregate && values[0].kind === "samples") {
          // Collapse: geometric mean of samples
          const arr = values[0].values;
          let logSum = 0; for (let i = 0; i < arr.length; i++) logSum += Math.log(arr[i]);
          return { kind: "scalar", value: Math.exp(logSum / arr.length) };
        }
        if (!isAggregate) return values[0];
        // Elementwise geometric mean: exp(mean(log(values)))
        const logSum = reduceElementwise(
          values.map(v => applyElementwise([v], Math.log, n)),
          (a, b) => a + b, n,
        );
        const logMean = binOp("/", logSum, { kind: "scalar", value: values.length }, n);
        return applyElementwise([logMean], Math.exp, n);
      }

      case "min": {
        if (!isAggregate && values[0].kind === "samples") {
          // Collapse: sample minimum
          const arr = values[0].values;
          let m = arr[0]; for (let i = 1; i < arr.length; i++) if (arr[i] < m) m = arr[i];
          return { kind: "scalar", value: m };
        }
        if (!isAggregate) return values[0];
        return reduceElementwise(values, Math.min, n);
      }

      case "max": {
        if (!isAggregate && values[0].kind === "samples") {
          // Collapse: sample maximum
          const arr = values[0].values;
          let m = arr[0]; for (let i = 1; i < arr.length; i++) if (arr[i] > m) m = arr[i];
          return { kind: "scalar", value: m };
        }
        if (!isAggregate) return values[0];
        return reduceElementwise(values, Math.max, n);
      }
    }
  }

  // ─── Regular functions (no range support) ─────────────────────────────

  const args = argExprs.map((e) => evalExpr(e, results, varMap, n, cells, ctx));

  switch (name) {
    // Math functions — 1 argument
    case "abs":
      if (args.length !== 1) throw new Error("abs(x) takes 1 argument");
      return applyElementwise(args, Math.abs, n);
    case "sqrt":
      if (args.length !== 1) throw new Error("sqrt(x) takes 1 argument");
      return applyElementwise(args, Math.sqrt, n);
    case "exp":
      if (args.length !== 1) throw new Error("exp(x) takes 1 argument");
      return applyElementwise(args, Math.exp, n);
    case "log":
    case "ln":
      if (args.length !== 1) throw new Error("log(x) takes 1 argument");
      return applyElementwise(args, Math.log, n);
    case "log10":
      if (args.length !== 1) throw new Error("log10(x) takes 1 argument");
      return applyElementwise(args, Math.log10, n);
    case "floor":
      if (args.length !== 1) throw new Error("floor(x) takes 1 argument");
      return applyElementwise(args, Math.floor, n);
    case "ceil":
      if (args.length !== 1) throw new Error("ceil(x) takes 1 argument");
      return applyElementwise(args, Math.ceil, n);
    case "round":
      if (args.length !== 1) throw new Error("round(x) takes 1 argument");
      return applyElementwise(args, Math.round, n);

    // Math functions — 2 arguments
    case "pow":
      if (args.length !== 2) throw new Error("pow(x, y) takes 2 arguments");
      return applyElementwise(args, Math.pow, n);

    // Clamping
    case "clamp":
      if (args.length !== 3) throw new Error("clamp(x, lo, hi) takes 3 arguments");
      return applyElementwise(args, (x, lo, hi) => Math.min(Math.max(x, lo), hi), n);

    // Conditional: if(condition, then, else) — condition > 0 is truthy
    case "if":
      if (args.length !== 3) throw new Error("if(cond, then, else) takes 3 arguments");
      return applyElementwise(args, (c, t, e) => c > 0 ? t : e, n);

    // Distribution constructors — return sample arrays
    // Each captures its samples for sensitivity analysis via _inlineSampleCapture
    case "normal": {
      if (args.length !== 2) throw new Error("Normal(mean, std) takes 2 arguments");
      const [meanR, stdR] = args;
      if (meanR.kind !== "scalar" || stdR.kind !== "scalar")
        throw new Error("Normal() parameters must be scalars");
      return captureDist(`Normal(${meanR.value}, ${stdR.value})`,
        { kind: "samples", values: sample({ type: "Normal", mean: meanR.value, std: stdR.value }, n) },
        meanR.value);
    }
    case "lognormal": {
      if (args.length !== 2) throw new Error("LogNormal(mu, sigma) takes 2 arguments");
      const [muR, sigmaR] = args;
      if (muR.kind !== "scalar" || sigmaR.kind !== "scalar")
        throw new Error("LogNormal() parameters must be scalars");
      return captureDist(`LogNormal(${muR.value}, ${sigmaR.value})`,
        { kind: "samples", values: sample({ type: "LogNormal", mu: muR.value, sigma: sigmaR.value }, n) },
        Math.exp(muR.value + sigmaR.value * sigmaR.value / 2));
    }
    case "uniform": {
      if (args.length !== 2) throw new Error("Uniform(low, high) takes 2 arguments");
      const [lowR, highR] = args;
      if (lowR.kind !== "scalar" || highR.kind !== "scalar")
        throw new Error("Uniform() parameters must be scalars");
      return captureDist(`Uniform(${lowR.value}, ${highR.value})`,
        { kind: "samples", values: sample({ type: "Uniform", low: lowR.value, high: highR.value }, n) },
        (lowR.value + highR.value) / 2);
    }
    case "triangular": {
      if (args.length !== 3) throw new Error("Triangular(low, mode, high) takes 3 arguments");
      const [tLow, tMode, tHigh] = args;
      if (tLow.kind !== "scalar" || tMode.kind !== "scalar" || tHigh.kind !== "scalar")
        throw new Error("Triangular() parameters must be scalars");
      return captureDist(`Triangular(${tLow.value}, ${tMode.value}, ${tHigh.value})`,
        { kind: "samples", values: sample({ type: "Triangular", low: tLow.value, mode: tMode.value, high: tHigh.value }, n) },
        (tLow.value + tMode.value + tHigh.value) / 3);
    }
    case "beta": {
      if (args.length !== 2) throw new Error("Beta(alpha, beta) takes 2 arguments");
      const [alphaR, betaR] = args;
      if (alphaR.kind !== "scalar" || betaR.kind !== "scalar")
        throw new Error("Beta() parameters must be scalars");
      return captureDist(`Beta(${alphaR.value}, ${betaR.value})`,
        { kind: "samples", values: sample({ type: "Beta", alpha: alphaR.value, beta: betaR.value }, n) },
        alphaR.value / (alphaR.value + betaR.value));
    }

    case "pareto": {
      if (args.length !== 2) throw new Error("Pareto(xMin, alpha) takes 2 arguments");
      const [xMinR, alphaR] = args;
      if (xMinR.kind !== "scalar" || alphaR.kind !== "scalar")
        throw new Error("Pareto() parameters must be scalars");
      const xMin = xMinR.value, alpha = alphaR.value;
      const ev = alpha > 1 ? alpha * xMin / (alpha - 1) : xMin;
      return captureDist(`Pareto(${xMin}, ${alpha})`,
        { kind: "samples", values: sample({ type: "Pareto", xMin, alpha }, n) }, ev);
    }
    case "poisson": {
      if (args.length !== 1) throw new Error("Poisson(lambda) takes 1 argument");
      const [lambdaR] = args;
      if (lambdaR.kind !== "scalar") throw new Error("Poisson() parameter must be scalar");
      const lambda = lambdaR.value;
      return captureDist(`Poisson(${lambda})`,
        { kind: "samples", values: sample({ type: "Poisson", lambda }, n) }, lambda);
    }
    case "studentt": {
      if (args.length !== 1 && args.length !== 3)
        throw new Error("StudentT(nu) or StudentT(nu, mu, sigma) takes 1 or 3 arguments");
      const [nuR, muR, sigmaR] = args;
      if (nuR.kind !== "scalar") throw new Error("StudentT() parameters must be scalars");
      const nu = nuR.value;
      const mu = muR?.kind === "scalar" ? muR.value : 0;
      const sigma = sigmaR?.kind === "scalar" ? sigmaR.value : 1;
      if (muR && muR.kind !== "scalar" || sigmaR && sigmaR.kind !== "scalar")
        throw new Error("StudentT() parameters must be scalars");
      const label = args.length === 1 ? `StudentT(${nu})` : `StudentT(${nu}, ${mu}, ${sigma})`;
      const ev = nu > 1 ? mu : mu;
      return captureDist(label,
        { kind: "samples", values: sample({ type: "StudentT", nu, mu, sigma }, n) }, ev);
    }

    // Bernoulli distribution — samples 0/1
    case "bernoulli": {
      if (args.length !== 1) throw new Error("bernoulli(p) takes 1 argument");
      const [pR] = args;
      if (pR.kind !== "scalar") throw new Error("bernoulli() parameter must be scalar");
      const p = pR.value;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.random() < p ? 1 : 0;
      return captureDist(`Bernoulli(${p})`, { kind: "samples", values: out }, p);
    }

    // Discrete distribution — samples from {0, 1, ..., N-1}
    case "discrete": {
      if (args.length < 2) throw new Error("discrete(p1, p2, ...) takes at least 2 arguments");
      const probs: number[] = [];
      for (const a of args) {
        if (a.kind !== "scalar") throw new Error("discrete() parameters must be scalars");
        probs.push(a.value);
      }
      // Build cumulative distribution
      const cdf: number[] = [];
      let cumsum = 0;
      for (const p of probs) {
        cumsum += p;
        cdf.push(cumsum);
      }
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * cumsum;
        let j = 0;
        while (j < cdf.length - 1 && u >= cdf[j]) j++;
        out[i] = j;
      }
      // Expected value: weighted mean of indices
      let ev = 0;
      for (let i = 0; i < probs.length; i++) ev += i * probs[i];
      ev /= cumsum;
      return captureDist(`Discrete(${probs.join(", ")})`, { kind: "samples", values: out }, ev);
    }

    default:
      throw new Error(`Unknown function: ${name}`);
  }
}

/**
 * Evaluate a single cell, storing its result.
 * If `tempOnly` is true (used by resample), only writes to the results map,
 * not to cell.result/cell.error — this avoids mutating the main cell state.
 */
function evalCell(
  addr: CellAddress,
  cell: Cell,
  results: Map<CellAddress, CellResult>,
  varMap: Map<string, CellAddress>,
  numSamples: number,
  cells: Map<CellAddress, Cell>,
  tempOnly = false,
  ctx?: CrossSheetCtx,
): void {
  if (!tempOnly) cell.error = undefined;
  if (!tempOnly) _currentEvalCell = cell;
  let result: CellResult | undefined;
  try {
    switch (cell.content.kind) {
      case "empty":
      case "text":
        result = undefined;
        break;
      case "number":
        result = { kind: "scalar", value: cell.content.value };
        break;
      case "distribution":
        result = {
          kind: "samples",
          values: sample(cell.content.dist, numSamples),
        };
        break;
      case "formula": {
        // Capture inline distribution samples for sensitivity analysis
        if (!tempOnly) {
          _inlineSampleCapture = [];
        }
        result = evalExpr(cell.content.expr, results, varMap, numSamples, cells, ctx);
        if (!tempOnly && _inlineSampleCapture && _inlineSampleCapture.length > 0) {
          cell.inlineSamples = _inlineSampleCapture;
        } else if (!tempOnly) {
          cell.inlineSamples = undefined;
        }
        _inlineSampleCapture = null;
        break;
      }
    }
  } catch (e) {
    if (!tempOnly) cell.error = (e as Error).message;
    result = undefined;
    _inlineSampleCapture = null;
  }
  if (!tempOnly) {
    cell.result = result;
    _currentEvalCell = null;
  }
  if (result) {
    results.set(addr, result);
  } else {
    results.delete(addr);
  }
}


// ─── Multi-sheet helpers ─────────────────────────────────────────────

/** Build varMaps for all sheets. Returns array parallel to sheets. */
function buildAllVarMaps(sheets: Sheet[]): {
  allVarMaps: Map<string, CellAddress>[];
  allDupAddrs: Set<CellAddress>[];
  allClearedAddrs: CellAddress[][];
} {
  const allVarMaps: Map<string, CellAddress>[] = [];
  const allDupAddrs: Set<CellAddress>[] = [];
  const allClearedAddrs: CellAddress[][] = [];
  for (const sheet of sheets) {
    const { varMap, dupAddrs, clearedAddrs } = buildVarMap(sheet.cells);
    allVarMaps.push(varMap);
    allDupAddrs.push(dupAddrs);
    allClearedAddrs.push(clearedAddrs);
  }
  return { allVarMaps, allDupAddrs, allClearedAddrs };
}

/** Global topological sort across all sheets. */
function globalTopoSort(
  allSheets: Sheet[],
  allVarMaps: Map<string, CellAddress>[],
): GlobalAddr[] {
  const order: GlobalAddr[] = [];
  const visited = new Set<GlobalAddr>();

  function visit(ga: GlobalAddr) {
    if (visited.has(ga)) return;
    visited.add(ga);

    const { sheetIdx, addr } = fromGlobal(ga);
    const cell = allSheets[sheetIdx]?.cells.get(addr);
    if (cell) {
      for (const dep of globalCellDeps(cell, addr, sheetIdx, allSheets, allVarMaps)) {
        visit(dep);
      }
    }
    order.push(ga);
  }

  for (let si = 0; si < allSheets.length; si++) {
    for (const addr of allSheets[si].cells.keys()) {
      visit(toGlobal(si, addr));
    }
  }
  return order;
}

/** Global topological sort with cycle detection. */
function globalTopoSortWithCycles(
  allSheets: Sheet[],
  allVarMaps: Map<string, CellAddress>[],
): { order: GlobalAddr[]; cycleAddrs: Set<GlobalAddr> } {
  const order: GlobalAddr[] = [];
  const visited = new Set<GlobalAddr>();
  const visiting = new Set<GlobalAddr>();
  const cycleAddrs = new Set<GlobalAddr>();

  function visit(ga: GlobalAddr): boolean {
    if (cycleAddrs.has(ga)) return false;
    if (visited.has(ga)) return true;
    if (visiting.has(ga)) {
      cycleAddrs.add(ga);
      return false;
    }
    visiting.add(ga);

    const { sheetIdx, addr } = fromGlobal(ga);
    const cell = allSheets[sheetIdx]?.cells.get(addr);
    if (cell) {
      for (const dep of globalCellDeps(cell, addr, sheetIdx, allSheets, allVarMaps)) {
        if (!visit(dep)) {
          cycleAddrs.add(ga);
          visiting.delete(ga);
          return false;
        }
      }
    }

    visiting.delete(ga);
    visited.add(ga);
    order.push(ga);
    return true;
  }

  for (let si = 0; si < allSheets.length; si++) {
    for (const addr of allSheets[si].cells.keys()) {
      visit(toGlobal(si, addr));
    }
  }
  return { order, cycleAddrs };
}

/** Build global reverse dependency map. */
function globalBuildReverseDeps(
  allSheets: Sheet[],
  allVarMaps: Map<string, CellAddress>[],
): Map<GlobalAddr, Set<GlobalAddr>> {
  const rev = new Map<GlobalAddr, Set<GlobalAddr>>();
  for (let si = 0; si < allSheets.length; si++) {
    for (const [addr, cell] of allSheets[si].cells) {
      const ga = toGlobal(si, addr);
      for (const dep of globalCellDeps(cell, addr, si, allSheets, allVarMaps)) {
        let set = rev.get(dep);
        if (!set) {
          set = new Set();
          rev.set(dep, set);
        }
        set.add(ga);
      }
    }
  }
  return rev;
}

/** Collect all downstream dependents of dirty global addresses (BFS). */
function globalCollectDirty(
  roots: GlobalAddr[],
  reverseDeps: Map<GlobalAddr, Set<GlobalAddr>>,
): Set<GlobalAddr> {
  const dirty = new Set<GlobalAddr>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const ga = queue.shift()!;
    const dependents = reverseDeps.get(ga);
    if (dependents) {
      for (const dep of dependents) {
        if (!dirty.has(dep)) {
          dirty.add(dep);
          queue.push(dep);
        }
      }
    }
  }
  return dirty;
}

/** Check if adding a cell at globalAddr with deps would create a global cycle. */
function globalWouldCycle(
  addr: GlobalAddr,
  newDeps: GlobalAddr[],
  allSheets: Sheet[],
  allVarMaps: Map<string, CellAddress>[],
): boolean {
  const visited = new Set<GlobalAddr>();

  function canReach(current: GlobalAddr): boolean {
    if (current === addr) return true;
    if (visited.has(current)) return false;
    visited.add(current);

    const { sheetIdx, addr: cellAddr } = fromGlobal(current);
    const cell = allSheets[sheetIdx]?.cells.get(cellAddr);
    if (!cell) return false;
    for (const dep of globalCellDeps(cell, addr, sheetIdx, allSheets, allVarMaps)) {
      if (canReach(dep)) return true;
    }
    return false;
  }

  for (const dep of newDeps) {
    if (canReach(dep)) return true;
  }
  return false;
}

// ─── Exported recalculation functions ────────────────────────────────

/**
 * Bulk recalculation with cycle detection across all sheets.
 * Used when loading files or pasting.
 */
/** Clear chain caches on all cells across all sheets */
function clearChainCaches(allSheets: Sheet[]): void {
  for (const sheet of allSheets) {
    for (const cell of sheet.cells.values()) {
      if (cell.chainCache) cell.chainCache = undefined;
    }
  }
}

export function recalculateBulk(sheet: Sheet, settings = DEFAULT_SETTINGS): void {
  recalculateAllBulk([sheet], settings);
}

/** Bulk recalculate all sheets with cross-sheet support and cycle detection. */
export function recalculateAllBulk(allSheets: Sheet[], settings = DEFAULT_SETTINGS): void {
  clearChainCaches(allSheets);
  const { allVarMaps, allDupAddrs } = buildAllVarMaps(allSheets);
  const { order, cycleAddrs } = globalTopoSortWithCycles(allSheets, allVarMaps);
  const allResults: Map<CellAddress, CellResult>[] = allSheets.map(() => new Map());

  // Mark cycle cells with errors
  for (const ga of cycleAddrs) {
    const { sheetIdx, addr } = fromGlobal(ga);
    const cell = allSheets[sheetIdx]?.cells.get(addr);
    if (cell) {
      cell.error = "Circular reference";
      cell.result = undefined;
    }
  }

  // Evaluate in global topological order
  for (const ga of order) {
    if (cycleAddrs.has(ga)) continue;
    const { sheetIdx, addr } = fromGlobal(ga);
    if (allDupAddrs[sheetIdx].has(addr)) continue;
    const sheet = allSheets[sheetIdx];
    const cell = sheet.cells.get(addr)!;
    const ctx: CrossSheetCtx = {
      allSheets,
      currentSheetIdx: sheetIdx,
      allVarMaps,
      allResults,
      settings,
    };
    evalCell(addr, cell, allResults[sheetIdx], allVarMaps[sheetIdx], settings.numSamples, sheet.cells, false, ctx);
  }
}

/** Recalculate all sheets from scratch. */
export function recalculate(sheet: Sheet, settings = DEFAULT_SETTINGS): void {
  recalculateAll([sheet], settings);
}

export function recalculateAll(allSheets: Sheet[], settings = DEFAULT_SETTINGS): void {
  clearChainCaches(allSheets);
  const { allVarMaps, allDupAddrs } = buildAllVarMaps(allSheets);
  const order = globalTopoSort(allSheets, allVarMaps);
  const allResults: Map<CellAddress, CellResult>[] = allSheets.map(() => new Map());

  for (const ga of order) {
    const { sheetIdx, addr } = fromGlobal(ga);
    if (allDupAddrs[sheetIdx].has(addr)) continue;
    const sheet = allSheets[sheetIdx];
    const cell = sheet.cells.get(addr)!;
    const ctx: CrossSheetCtx = {
      allSheets,
      currentSheetIdx: sheetIdx,
      allVarMaps,
      allResults,
      settings,
    };
    evalCell(addr, cell, allResults[sheetIdx], allVarMaps[sheetIdx], settings.numSamples, sheet.cells, false, ctx);
  }
}

/**
 * Incremental recalculation across all sheets: only re-evaluate changed cells
 * and their downstream dependents (including cross-sheet).
 */
export function recalculateFrom(sheet: Sheet, changedAddrs: CellAddress[], settings = DEFAULT_SETTINGS): void {
  recalculateAllFrom([sheet], 0, changedAddrs, settings);
}

export function recalculateAllFrom(
  allSheets: Sheet[],
  changedSheetIdx: number,
  changedAddrs: CellAddress[],
  settings = DEFAULT_SETTINGS,
): void {
  clearChainCaches(allSheets);
  const { allVarMaps, allDupAddrs, allClearedAddrs } = buildAllVarMaps(allSheets);

  const globalRoots = changedAddrs.map((a) => toGlobal(changedSheetIdx, a));
  // Include cleared duplicate addrs as dirty roots
  for (let si = 0; si < allSheets.length; si++) {
    for (const addr of allClearedAddrs[si]) {
      globalRoots.push(toGlobal(si, addr));
    }
  }

  const reverseDeps = globalBuildReverseDeps(allSheets, allVarMaps);
  const dirty = globalCollectDirty(globalRoots, reverseDeps);

  const fullOrder = globalTopoSort(allSheets, allVarMaps);

  // Build results maps from existing cell results
  const allResults: Map<CellAddress, CellResult>[] = allSheets.map((sheet) => {
    const results = new Map<CellAddress, CellResult>();
    for (const [addr, cell] of sheet.cells) {
      if (cell.result) results.set(addr, cell.result);
    }
    return results;
  });

  // Re-evaluate only dirty cells in global topological order
  for (const ga of fullOrder) {
    if (!dirty.has(ga)) continue;
    const { sheetIdx, addr } = fromGlobal(ga);
    if (allDupAddrs[sheetIdx].has(addr)) continue;
    const sheet = allSheets[sheetIdx];
    const cell = sheet.cells.get(addr)!;
    const ctx: CrossSheetCtx = {
      allSheets,
      currentSheetIdx: sheetIdx,
      allVarMaps,
      allResults,
      settings,
    };
    evalCell(addr, cell, allResults[sheetIdx], allVarMaps[sheetIdx], settings.numSamples, sheet.cells, false, ctx);
  }
}

/** Set a cell's raw value, parse it, and recalculate.
 *  Returns the cell, which will have an error set if the edit would create a cycle. */
export function setCellRaw(
  sheet: Sheet,
  addr: CellAddress,
  raw: string,
  allSheets?: Sheet[],
  sheetIndex?: number,
  settings = DEFAULT_SETTINGS,
): Cell | undefined {
  const sheets = allSheets ?? [sheet];
  const si = sheetIndex ?? 0;

  if (raw.trim() === "") {
    sheet.cells.delete(addr);
    const dirty = [addr];
    const parsed = parseAddress(addr);
    if (parsed) {
      const rightAddr = toAddress(parsed.col + 1, parsed.row);
      const rightCell = sheet.cells.get(rightAddr);
      if (rightCell?.labelVar) {
        dirty.push(rightAddr);
      }
    }
    recalculateAllFrom(sheets, si, dirty, settings);
    return undefined;
  }

  const { content, variableName, labelVar } = parseCell(raw);
  const cell: Cell = { raw, content, variableName, labelVar };

  // Check for cycles before committing the edit
  if (content.kind === "formula") {
    const prev = sheet.cells.get(addr);
    sheet.cells.set(addr, cell);
    const { allVarMaps } = buildAllVarMaps(sheets);
    const deps = globalCellDeps(cell, addr, si, sheets, allVarMaps);
    const globalAddr = toGlobal(si, addr);

    if (globalWouldCycle(globalAddr, deps, sheets, allVarMaps)) {
      if (prev) {
        sheet.cells.set(addr, prev);
      } else {
        sheet.cells.delete(addr);
      }
      cell.error = "Circular reference";
      cell.result = undefined;
      sheet.cells.set(addr, cell);
      return cell;
    }
  }

  sheet.cells.set(addr, cell);

  // If this is a text cell, also dirty the cell to the right if it uses labelVar
  const dirty = [addr];
  if (content.kind === "text" || content.kind === "empty") {
    const parsed = parseAddress(addr);
    if (parsed) {
      const rightAddr = toAddress(parsed.col + 1, parsed.row);
      const rightCell = sheet.cells.get(rightAddr);
      if (rightCell?.labelVar) {
        const oldVarName = rightCell.variableName;
        dirty.push(rightAddr);
        if (oldVarName) {
          // Dirty cells in this sheet that referenced the old variable name
          for (const [depAddr, depCell] of sheet.cells) {
            if (depCell.content.kind === "formula") {
              const { varRefs } = exprDeps(depCell.content.expr);
              if (varRefs.includes(oldVarName)) {
                dirty.push(depAddr);
              }
            }
          }
        }
      }
    }
  }

  recalculateAllFrom(sheets, si, dirty, settings);
  return cell;
}

/**
 * Resolve a reference string (cell address, variable name, or Sheet.ref) to a Cell.
 * Returns { cell, sheetIndex, addr } or null if not found.
 */
export function resolveReference(
  ref: string,
  currentSheetIdx: number,
  allSheets: Sheet[],
): { cell: Cell; sheetIndex: number; addr: CellAddress } | null {
  const trimmed = ref.trim();
  const { allVarMaps } = buildAllVarMaps(allSheets);

  // Cross-sheet reference: Sheet.ref or 'Sheet'.ref
  const dotMatch = trimmed.match(new RegExp(`^(?:'([^']+)'|(${ID_START_SRC}${ID_CONT_SRC}*))\\.(.+)$`, "u"));
  if (dotMatch) {
    const sheetName = dotMatch[1] ?? dotMatch[2];
    const rest = dotMatch[3];
    const targetIdx = findSheetIndex(allSheets, sheetName);
    if (targetIdx < 0) return null;

    // Try as cell address
    const parsed = parseAddress(rest.toUpperCase());
    if (parsed) {
      const addr = toAddress(parsed.col, parsed.row);
      const cell = allSheets[targetIdx].cells.get(addr);
      if (cell) return { cell, sheetIndex: targetIdx, addr };
    }

    // Try as variable
    const varAddr = allVarMaps[targetIdx].get(rest.toLowerCase());
    if (varAddr) {
      const cell = allSheets[targetIdx].cells.get(varAddr);
      if (cell) return { cell, sheetIndex: targetIdx, addr: varAddr };
    }
    return null;
  }

  // Local cell address (e.g. "A1", "B3")
  const parsed = parseAddress(trimmed.toUpperCase());
  if (parsed) {
    const addr = toAddress(parsed.col, parsed.row);
    const cell = allSheets[currentSheetIdx].cells.get(addr);
    if (cell) return { cell, sheetIndex: currentSheetIdx, addr };
  }

  // Local variable name
  const varAddr = allVarMaps[currentSheetIdx].get(trimmed.toLowerCase());
  if (varAddr) {
    const cell = allSheets[currentSheetIdx].cells.get(varAddr);
    if (cell) return { cell, sheetIndex: currentSheetIdx, addr: varAddr };
  }

  return null;
}

/** Create an empty sheet */
export function createSheet(name = DEFAULT_SHEET_NAME): Sheet {
  return { name, cells: new Map() };
}

/** Default workbook settings */
export const DEFAULT_SETTINGS: WorkbookSettings = {
  numSamples: DEFAULT_NUM_SAMPLES,
  chainSearchLimit: DEFAULT_CHAIN_SEARCH_LIMIT,
};

/**
 * Find all cross-sheet references to a given sheet name.
 * Returns array of { sheetIndex, addr, sheetName } for each cell that references the target.
 */
export function findRefsToSheet(
  allSheets: Sheet[],
  targetSheetName: string,
): { sheetIndex: number; addr: CellAddress }[] {
  const targetLower = targetSheetName.toLowerCase();
  const refs: { sheetIndex: number; addr: CellAddress }[] = [];
  for (let si = 0; si < allSheets.length; si++) {
    for (const [addr, cell] of allSheets[si].cells) {
      if (cell.content.kind !== "formula") continue;
      const { sheetRefs } = exprDeps(cell.content.expr);
      if (sheetRefs.some((r) => r.sheet.toLowerCase() === targetLower)) {
        refs.push({ sheetIndex: si, addr });
      }
    }
  }
  return refs;
}

/**
 * Rename a sheet and update all cross-sheet references in all sheets.
 * Modifies raw cell strings and re-parses affected cells.
 */
export function renameSheet(
  allSheets: Sheet[],
  sheetIndex: number,
  newName: string,
): void {
  const oldName = allSheets[sheetIndex].name;
  allSheets[sheetIndex].name = newName;

  // Build regex patterns for old name references in raw cell text
  // Handle both unquoted (OldName.ref) and quoted ('Old Name'.ref) forms
  const needsQuotes = (name: string) => /[^\p{L}\p{N}_]/u.test(name);
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Build replacement patterns
  const patterns: { regex: RegExp; replacement: string }[] = [];

  // Unquoted old name
  if (!needsQuotes(oldName)) {
    patterns.push({
      regex: new RegExp(`(?<!${ID_CONT_SRC}|')${escapeRegex(oldName)}\\.`, "giu"),
      replacement: needsQuotes(newName) ? `'${newName}'.` : `${newName}.`,
    });
  }
  // Quoted old name
  patterns.push({
    regex: new RegExp(`'${escapeRegex(oldName)}'\\s*\\.`, "gi"),
    replacement: needsQuotes(newName) ? `'${newName}'.` : `${newName}.`,
  });

  // Update all cells in all sheets
  for (const sheet of allSheets) {
    for (const [addr, cell] of sheet.cells) {
      let raw = cell.raw;
      let changed = false;
      for (const { regex, replacement } of patterns) {
        const newRaw = raw.replace(regex, replacement);
        if (newRaw !== raw) {
          raw = newRaw;
          changed = true;
        }
      }
      if (changed) {
        const { content, variableName, labelVar } = parseCell(raw);
        sheet.cells.set(addr, { raw, content, variableName, labelVar });
      }
    }
  }

  // Recalculate everything
  recalculateAllBulk(allSheets);
}

/** Compute summary stats from a CellResult */
export function summarize(result: CellResult): {
  mean: number;
  std: number;
  p1: number;
  p5: number;
  p10: number;
  p25: number;
  p40: number;
  p50: number;
  p60: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
} {
  if (result.kind === "scalar") {
    const v = result.value;
    return { mean: v, std: 0, p1: v, p5: v, p10: v, p25: v, p40: v, p50: v, p60: v, p75: v, p90: v, p95: v, p99: v };
  }

  const vals = result.values;
  const n = vals.length;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += vals[i];
  const mean = sum / n;

  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += (vals[i] - mean) ** 2;
  const std = Math.sqrt(sumSq / n);

  // Sort a copy for percentiles
  const sorted = new Float64Array(vals).sort();
  const p = (frac: number) => sorted[Math.floor(frac * (n - 1))];

  return { mean, std, p1: p(0.01), p5: p(0.05), p10: p(0.1), p25: p(0.25), p40: p(0.4), p50: p(0.5), p60: p(0.6), p75: p(0.75), p90: p(0.9), p95: p(0.95), p99: p(0.99) };
}

// ─── Sensitivity analysis ────────────────────────────────────────────

/** Check if an expression contains any inline distribution constructors */
function hasInlineDistribution(expr: Expr): boolean {
  switch (expr.type) {
    case "number":
    case "cellRef":
    case "varRef":
    case "sheetCellRef":
    case "sheetVarRef":
      return false;
    case "binOp":
      return hasInlineDistribution(expr.left) || hasInlineDistribution(expr.right);
    case "unaryMinus":
      return hasInlineDistribution(expr.operand);
    case "funcCall":
      if (SAMPLE_CONSTRUCTORS.has(expr.name)) return true;
      return expr.args.some(hasInlineDistribution);
    case "markov":
      return false; // Markov emissions come from external cells, not inline
    case "cellRange":
    case "chainRange":
    case "chainStep":
      return false;
  }
}

/** An input cell for sensitivity analysis */
export interface SensitivityInput {
  sheetIndex: number;
  addr: CellAddress;
  label: string;          // variable name, or "Sheet.var", or cell address
  detail: string;         // raw cell text for context
  result: CellResult;
  isScalar: boolean;
  isInline?: boolean;     // inline distribution — no separate samples for correlation
}

/**
 * Collect the distribution inputs (sources of randomness) for a given output cell.
 * Walks the sub-DAG and returns leaf cells that introduce their own randomness:
 * - Distribution cells (content.kind === "distribution")
 * - Formulas with inline distribution constructors
 * - Scalar cells (for tornado context, marked isScalar=true)
 * Intermediate formula cells (that just combine upstream randomness) are excluded.
 */
export function collectInputs(
  outputAddr: CellAddress,
  outputSheetIdx: number,
  allSheets: Sheet[],
): SensitivityInput[] {
  const { allVarMaps } = buildAllVarMaps(allSheets);
  const visited = new Set<GlobalAddr>();
  const inputs: SensitivityInput[] = [];

  function visit(sheetIdx: number, addr: CellAddress) {
    const ga = toGlobal(sheetIdx, addr);
    if (visited.has(ga)) return;
    visited.add(ga);

    const cell = allSheets[sheetIdx]?.cells.get(addr);
    if (!cell) return;

    const isSource =
      cell.content.kind === "distribution" ||
      cell.content.kind === "number" ||
      (cell.content.kind === "formula" && hasInlineDistribution(cell.content.expr));

    if (isSource && cell.result) {
      // Build label
      let label: string;
      if (cell.variableName) {
        label = sheetIdx !== outputSheetIdx
          ? `${allSheets[sheetIdx].name}.${cell.variableName}`
          : cell.variableName;
      } else {
        label = sheetIdx !== outputSheetIdx
          ? `${allSheets[sheetIdx].name}.${addr}`
          : addr;
      }

      inputs.push({
        sheetIndex: sheetIdx,
        addr,
        label,
        detail: cell.raw,
        result: cell.result,
        isScalar: cell.result.kind === "scalar",
      });

      // Don't recurse into source cells' dependencies — they're leaf sources
      // (Exception: formulas with inline distributions may also depend on other cells,
      //  but we treat the whole cell as one source for simplicity)
      if (cell.content.kind !== "formula") return;
    }

    // Recurse into dependencies
    if (cell.content.kind === "formula") {
      const { cellRefs, varRefs, sheetRefs } = exprDeps(cell.content.expr);
      for (const ref of cellRefs) {
        visit(sheetIdx, ref);
      }
      for (const v of varRefs) {
        const resolved = allVarMaps[sheetIdx].get(v);
        if (resolved) visit(sheetIdx, resolved);
      }
      for (const sr of sheetRefs) {
        const targetIdx = findSheetIndex(allSheets, sr.sheet);
        if (targetIdx < 0) continue;
        if (sr.addr) {
          visit(targetIdx, sr.addr);
        } else if (sr.varName) {
          const resolved = allVarMaps[targetIdx].get(sr.varName);
          if (resolved) visit(targetIdx, resolved);
        }
      }
    }
  }

  // Start from the output cell's dependencies (not the output itself)
  const outputCell = allSheets[outputSheetIdx]?.cells.get(outputAddr);
  if (!outputCell || outputCell.content.kind !== "formula") return [];

  const { cellRefs, varRefs, sheetRefs } = exprDeps(outputCell.content.expr);
  for (const ref of cellRefs) {
    visit(outputSheetIdx, ref);
  }
  for (const v of varRefs) {
    const resolved = allVarMaps[outputSheetIdx].get(v);
    if (resolved) visit(outputSheetIdx, resolved);
  }
  for (const sr of sheetRefs) {
    const targetIdx = findSheetIndex(allSheets, sr.sheet);
    if (targetIdx < 0) continue;
    if (sr.addr) {
      visit(targetIdx, sr.addr);
    } else if (sr.varName) {
      const resolved = allVarMaps[targetIdx].get(sr.varName);
      if (resolved) visit(targetIdx, resolved);
    }
  }

  // Include inline distribution samples captured during evaluation
  if (outputCell.inlineSamples) {
    for (const is of outputCell.inlineSamples) {
      inputs.push({
        sheetIndex: outputSheetIdx,
        addr: outputAddr,
        label: is.label,
        detail: `inline in ${outputAddr}`,
        result: { kind: "samples", values: is.values },
        isScalar: false,
        isInline: true,
      });
    }
  }

  // For Chain cells, the body is stored but not evaluated during the main DAG pass,
  // so inlineSamples won't contain body distributions. Detect them from the expression.
  if (outputCell.chainBody) {
    const bodyLabels = collectInlineDistLabels(outputCell.chainBody);
    for (const label of bodyLabels) {
      // Avoid duplicates if somehow already captured
      if (!inputs.some(inp => inp.isInline && inp.label === label)) {
        inputs.push({
          sheetIndex: outputSheetIdx,
          addr: outputAddr,
          label,
          detail: `inline in Chain body`,
          result: { kind: "scalar", value: 0 }, // placeholder — no samples available
          isScalar: false,
          isInline: true,
        });
      }
    }
  }

  return inputs;
}

/** Extract labels for inline distribution constructors from an expression */
function collectInlineDistLabels(expr: Expr): string[] {
  const labels: string[] = [];
  function walk(e: Expr) {
    switch (e.type) {
      case "number":
      case "cellRef":
      case "varRef":
      case "sheetCellRef":
      case "sheetVarRef":
        break;
      case "binOp":
        walk(e.left);
        walk(e.right);
        break;
      case "unaryMinus":
        walk(e.operand);
        break;
      case "funcCall":
        if (SAMPLE_CONSTRUCTORS.has(e.name)) {
          // Build label like "Normal(100, 10)"
          const argStrs = e.args.map(a => a.type === "number" ? String(a.value) : "…");
          labels.push(`${e.name.charAt(0).toUpperCase() + e.name.slice(1)}(${argStrs.join(", ")})`);
        }
        e.args.forEach(walk);
        break;
      case "markov":
        break; // Markov emissions come from external cells
      case "cellRange":
      case "chainRange":
        break;
    }
  }
  walk(expr);
  return labels;
}

/** Compute Spearman rank correlation between two Float64Arrays */
export function spearmanCorrelation(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;

  // Rank arrays (average rank for ties)
  function rank(arr: Float64Array): Float64Array {
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((i, j) => arr[i] - arr[j]);
    const ranks = new Float64Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n - 1 && arr[indices[j + 1]] === arr[indices[j]]) j++;
      const avgRank = (i + j) / 2;
      for (let k = i; k <= j; k++) ranks[indices[k]] = avgRank;
      i = j + 1;
    }
    return ranks;
  }

  const ra = rank(a);
  const rb = rank(b);

  // Pearson correlation on ranks
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += ra[i]; sumB += rb[i]; }
  const meanA = sumA / n, meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

/** Tornado diagram data: for each input, the output value when that input
 *  is at mean-σ vs mean+σ while all others are held at their means.
 *  outputAtLow = output when input is at mean-σ
 *  outputAtHigh = output when input is at mean+σ */
export interface TornadoBar {
  label: string;
  detail: string;
  outputAtLow: number;   // output when this input is at mean - σ
  outputAtHigh: number;   // output when this input is at mean + σ
  isInline: boolean;
}

/**
 * Compute tornado diagram data for a given output cell.
 * For each distribution input, evaluates the output with that input at ±1σ
 * while all other inputs are held at their means.
 */
export function computeTornado(
  outputAddr: CellAddress,
  outputSheetIdx: number,
  allSheets: Sheet[],
  settings = DEFAULT_SETTINGS,
): TornadoBar[] {
  const inputs = collectInputs(outputAddr, outputSheetIdx, allSheets);
  const distInputs = inputs.filter((inp) => !inp.isScalar && inp.result.kind === "samples");
  if (distInputs.length === 0) return [];

  const outputCell = allSheets[outputSheetIdx]?.cells.get(outputAddr);
  if (!outputCell || outputCell.content.kind !== "formula") return [];

  const { allVarMaps } = buildAllVarMaps(allSheets);

  // Compute stats for each distribution input
  const inputStats = distInputs.map((inp) => {
    const s = summarize(inp.result);
    return { ...inp, mean: s.mean, std: s.std, p5: s.p5, p95: s.p95 };
  });

  // Collect the output cell's sub-DAG in topological order (for deterministic re-evaluation)
  const subDag = collectSubDag(outputAddr, allSheets[outputSheetIdx].cells, allVarMaps[outputSheetIdx]);

  // Map of distribution input addrs to their mean values (for holding at baseline)
  const inputMeans = new Map<string, number>(); // "sheetIdx:addr" → mean
  for (const inp of inputStats) {
    if (!inp.isInline) {
      inputMeans.set(toGlobal(inp.sheetIndex, inp.addr), inp.mean);
    }
  }

  /**
   * Deterministically evaluate the output's sub-DAG with one input at a specific value
   * and all other distribution inputs at their means.
   */
  function evalScenario(
    variedInputGA: string | null, // global addr of the input being varied (null = all at means)
    variedValue: number,
  ): number {
    const scenarioResults: Map<CellAddress, CellResult>[] = allSheets.map((sheet) => {
      const results = new Map<CellAddress, CellResult>();
      for (const [addr, cell] of sheet.cells) {
        if (cell.result) results.set(addr, cell.result);
      }
      return results;
    });

    // Override all distribution inputs with their means
    for (const [ga, mean] of inputMeans) {
      const { sheetIdx, addr } = fromGlobal(ga);
      scenarioResults[sheetIdx].set(addr, { kind: "scalar", value: mean });
    }

    // Override the varied input with the scenario value
    if (variedInputGA) {
      const { sheetIdx, addr } = fromGlobal(variedInputGA);
      scenarioResults[sheetIdx].set(addr, { kind: "scalar", value: variedValue });
    }

    // Re-evaluate the sub-DAG in topological order
    const ctx: CrossSheetCtx = {
      allSheets,
      currentSheetIdx: outputSheetIdx,
      allVarMaps,
      allResults: scenarioResults,
      settings,
    };

    _deterministicMode = true;
    try {
      for (const addr of subDag) {
        const cell = allSheets[outputSheetIdx].cells.get(addr);
        if (!cell) continue;
        // Skip cells that are distribution inputs (already overridden)
        const ga = toGlobal(outputSheetIdx, addr);
        if (inputMeans.has(ga)) continue;

        if (cell.content.kind === "formula") {
          const result = evalExpr(
            cell.content.expr,
            scenarioResults[outputSheetIdx],
            allVarMaps[outputSheetIdx],
            1,
            allSheets[outputSheetIdx].cells,
            ctx,
          );
          scenarioResults[outputSheetIdx].set(addr,
            result.kind === "scalar" ? result : { kind: "scalar", value: summarize(result).mean });
        }
      }

      const outResult = scenarioResults[outputSheetIdx].get(outputAddr);
      if (!outResult) return NaN;
      return outResult.kind === "scalar" ? outResult.value : summarize(outResult).mean;
    } catch {
      return NaN;
    } finally {
      _deterministicMode = false;
    }
  }

  const bars: TornadoBar[] = [];
  for (const inp of inputStats) {
    if (inp.p5 === inp.p95) continue;

    const lowVal = inp.p5;
    const highVal = inp.p95;

    if (inp.isInline) {
      // Can't do one-at-a-time override for inline distributions
      // Estimate swing from correlation and output P5-P95 range
      const inpValues = inp.result.kind === "samples" ? inp.result.values : new Float64Array(0);
      const outValues = outputCell.result!.kind === "samples" ? outputCell.result!.values : new Float64Array(0);
      const r = spearmanCorrelation(inpValues, outValues);
      const outputStats = summarize(outputCell.result!);
      const outputRange = outputStats.p95 - outputStats.p5;
      const swing = Math.abs(r) * outputRange / 2;
      bars.push({
        label: inp.label,
        detail: inp.detail,
        outputAtLow: outputStats.mean - swing * Math.sign(r),
        outputAtHigh: outputStats.mean + swing * Math.sign(r),
        isInline: true,
      });
    } else {
      const ga = toGlobal(inp.sheetIndex, inp.addr);
      const outputLow = evalScenario(ga, lowVal);
      const outputHigh = evalScenario(ga, highVal);
      if (!isNaN(outputLow) && !isNaN(outputHigh)) {
        bars.push({
          label: inp.label,
          detail: inp.detail,
          outputAtLow: outputLow,
          outputAtHigh: outputHigh,
          isInline: false,
        });
      }
    }
  }

  // Sort by swing (largest first = tornado shape)
  bars.sort((a, b) =>
    Math.abs(b.outputAtHigh - b.outputAtLow) - Math.abs(a.outputAtHigh - a.outputAtLow)
  );
  return bars;
}

/** Compute summary stats for each step of a chain, up to numSteps.
 *  Lazily evaluates chain steps as needed. */
export function computeChainTimeline(
  cell: Cell,
  cellAddr: CellAddress,
  numSteps: number,
  allSheets: Sheet[],
  sheetIndex: number,
  settings = DEFAULT_SETTINGS,
): (ReturnType<typeof summarize> & { step: number })[] {
  if (!cell.chainBody || !cell.chainInitial) return [];

  const sheet = allSheets[sheetIndex];
  const { allVarMaps } = buildAllVarMaps(allSheets);
  const allResults: Map<CellAddress, CellResult>[] = allSheets.map(() => new Map());

  // Populate results from existing cell results
  for (let si = 0; si < allSheets.length; si++) {
    for (const [addr, c] of allSheets[si].cells) {
      if (c.result) allResults[si].set(addr, c.result);
    }
  }

  const ctx: CrossSheetCtx = {
    allSheets,
    currentSheetIdx: sheetIndex,
    allVarMaps,
    allResults,
    settings,
  };

  // Ensure steps are computed
  evaluateChainStep(cell, cellAddr, numSteps, allResults[sheetIndex], allVarMaps[sheetIndex], settings.numSamples, sheet.cells, ctx);

  const timeline: (ReturnType<typeof summarize> & { step: number })[] = [];
  for (let t = 0; t <= numSteps && t < (cell.chainCache?.length ?? 0); t++) {
    const stats = summarize({ kind: "samples", values: cell.chainCache![t] });
    timeline.push({ step: t, ...stats });
  }
  return timeline;
}

/** Get the chain step result for the detail view. Lazily computes if needed. */
export function getChainStepResult(
  cell: Cell,
  cellAddr: CellAddress,
  step: number,
  allSheets: Sheet[],
  sheetIndex: number,
  settings = DEFAULT_SETTINGS,
): CellResult {
  if (!cell.chainBody || !cell.chainInitial) {
    return cell.result ?? { kind: "scalar", value: 0 };
  }

  const sheet = allSheets[sheetIndex];
  const { allVarMaps } = buildAllVarMaps(allSheets);
  const allResults: Map<CellAddress, CellResult>[] = allSheets.map(() => new Map());

  for (let si = 0; si < allSheets.length; si++) {
    for (const [addr, c] of allSheets[si].cells) {
      if (c.result) allResults[si].set(addr, c.result);
    }
  }

  const ctx: CrossSheetCtx = {
    allSheets,
    currentSheetIdx: sheetIndex,
    allVarMaps,
    allResults,
    settings,
  };

  const values = evaluateChainStep(cell, cellAddr, step, allResults[sheetIndex], allVarMaps[sheetIndex], settings.numSamples, sheet.cells, ctx);
  return { kind: "samples", values };
}

/** Compute histogram bins from samples.
 *  If fixedMin/fixedMax are provided, use that range instead of the data range.
 *  Samples outside the fixed range are clamped into the edge bins. */
export function histogram(
  result: CellResult,
  numBins = DEFAULT_NUM_HISTOGRAM_BINS,
  fixedMin?: number,
  fixedMax?: number,
): { min: number; max: number; bins: number[]; binWidth: number } {
  if (result.kind === "scalar") {
    const bins = new Array(numBins).fill(0);
    bins[Math.floor(numBins / 2)] = 1;
    return { min: result.value - 1, max: result.value + 1, bins, binWidth: 2 / numBins };
  }

  const vals = result.values;

  let min: number, max: number;
  if (fixedMin != null && fixedMax != null) {
    min = fixedMin;
    max = fixedMax;
  } else {
    // Use P1-P99 to avoid extreme outliers dominating the range
    const sorted = Float64Array.from(vals).sort();
    const p01Idx = Math.floor(0.01 * (sorted.length - 1));
    const p99Idx = Math.ceil(0.99 * (sorted.length - 1));
    min = sorted[p01Idx];
    max = sorted[p99Idx];
  }

  if (min === max) {
    const bins = new Array(numBins).fill(0);
    bins[Math.floor(numBins / 2)] = vals.length;
    return { min: min - 1, max: max + 1, bins, binWidth: 2 / numBins };
  }

  const binWidth = (max - min) / numBins;
  // Snap bin edges to a stable grid so panning doesn't shuffle samples between bins.
  // Align min down and max up to the nearest multiple of binWidth.
  const snappedMin = Math.floor(min / binWidth) * binWidth;
  const snappedMax = snappedMin + numBins * binWidth;

  const bins = new Array(numBins).fill(0);
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] < snappedMin || vals[i] > snappedMax) continue;
    let bin = Math.floor((vals[i] - snappedMin) / binWidth);
    if (bin >= numBins) bin = numBins - 1;
    bins[bin]++;
  }

  return { min: snappedMin, max: snappedMax, bins, binWidth };
}
