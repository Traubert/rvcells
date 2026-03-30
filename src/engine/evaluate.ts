import type { Cell, CellAddress, CellResult, Expr, Sheet } from "./types";
import { toAddress, parseAddress } from "./types";
import { sample } from "./distributions";
import { parseCell } from "./parser";

/** Collect all cell/variable dependencies from an expression */
function exprDeps(expr: Expr): { cellRefs: CellAddress[]; varRefs: string[] } {
  const cellRefs: CellAddress[] = [];
  const varRefs: string[] = [];

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
    }
  }
  walk(expr);
  return { cellRefs, varRefs };
}

/** Convert text to a valid variable name: lowercase, spaces/hyphens to underscores */
function textToVarName(text: string): string | undefined {
  const name = text.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!name || /^\d/.test(name)) return undefined;
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
    if (cell.variableName && cell.error?.startsWith("Duplicate variable")) {
      cell.error = undefined;
      clearedAddrs.push(addr);
    }
  }
  const varMap = new Map<string, CellAddress>();
  const dupAddrs = new Set<CellAddress>();
  for (const [addr, cell] of cells) {
    if (cell.variableName) {
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
  // Only report cleared addrs that are truly cleared (not re-marked as duplicate)
  return { varMap, dupAddrs, clearedAddrs: clearedAddrs.filter(a => !dupAddrs.has(a)) };
}

/** Get all direct dependencies of a cell as cell addresses */
function cellDeps(cell: Cell, varMap: Map<string, CellAddress>): CellAddress[] {
  if (cell.content.kind !== "formula") return [];
  const { cellRefs, varRefs } = exprDeps(cell.content.expr);
  const deps = [...cellRefs];
  for (const v of varRefs) {
    const addr = varMap.get(v);
    if (addr) deps.push(addr);
  }
  return deps;
}

/** Topological sort. Assumes no cycles (caller must check beforehand). */
function topoSort(
  cells: Map<CellAddress, Cell>,
  varMap: Map<string, CellAddress>
): CellAddress[] {
  const order: CellAddress[] = [];
  const visited = new Set<CellAddress>();

  function visit(addr: CellAddress) {
    if (visited.has(addr)) return;
    visited.add(addr);

    const cell = cells.get(addr);
    if (cell) {
      for (const dep of cellDeps(cell, varMap)) {
        visit(dep);
      }
    }

    order.push(addr);
  }

  for (const addr of cells.keys()) {
    visit(addr);
  }

  return order;
}

/**
 * Check whether adding/updating a cell at `addr` with the given deps
 * would create a cycle. Walks forward from `addr`'s dependencies to see
 * if any path leads back to `addr`.
 */
function wouldCycle(
  addr: CellAddress,
  newDeps: CellAddress[],
  cells: Map<CellAddress, Cell>,
  varMap: Map<string, CellAddress>
): boolean {
  // DFS from each direct dependency — can we reach `addr`?
  const visited = new Set<CellAddress>();

  function canReach(current: CellAddress): boolean {
    if (current === addr) return true;
    if (visited.has(current)) return false;
    visited.add(current);

    const cell = cells.get(current);
    if (!cell) return false;
    for (const dep of cellDeps(cell, varMap)) {
      if (canReach(dep)) return true;
    }
    return false;
  }

  for (const dep of newDeps) {
    if (canReach(dep)) return true;
  }
  return false;
}

/** Apply a binary operation elementwise, handling scalar/samples mixing */
function binOp(
  op: "+" | "-" | "*" | "/",
  a: CellResult,
  b: CellResult,
  n: number
): CellResult {
  // Both scalar
  if (a.kind === "scalar" && b.kind === "scalar") {
    switch (op) {
      case "+": return { kind: "scalar", value: a.value + b.value };
      case "-": return { kind: "scalar", value: a.value - b.value };
      case "*": return { kind: "scalar", value: a.value * b.value };
      case "/": return { kind: "scalar", value: a.value / b.value };
    }
  }

  // At least one is samples — promote both to arrays
  const aArr = a.kind === "samples" ? a.values : broadcastScalar(a.value, n);
  const bArr = b.kind === "samples" ? b.values : broadcastScalar(b.value, n);
  const out = new Float64Array(n);

  switch (op) {
    case "+": for (let i = 0; i < n; i++) out[i] = aArr[i] + bArr[i]; break;
    case "-": for (let i = 0; i < n; i++) out[i] = aArr[i] - bArr[i]; break;
    case "*": for (let i = 0; i < n; i++) out[i] = aArr[i] * bArr[i]; break;
    case "/": for (let i = 0; i < n; i++) out[i] = aArr[i] / bArr[i]; break;
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
): CellResult {
  switch (expr.type) {
    case "number":
      return { kind: "scalar", value: expr.value };

    case "cellRef": {
      const addr = toAddress(expr.col, expr.row);
      return results.get(addr) ?? { kind: "scalar", value: 0 };
    }

    case "varRef": {
      const addr = varMap.get(expr.name);
      if (!addr) throw new Error(`Unknown variable: ${expr.name}`);
      return results.get(addr) ?? { kind: "scalar", value: 0 };
    }

    case "binOp": {
      const left = evalExpr(expr.left, results, varMap, n, cells);
      const right = evalExpr(expr.right, results, varMap, n, cells);
      return binOp(expr.op, left, right, n);
    }

    case "unaryMinus": {
      const operand = evalExpr(expr.operand, results, varMap, n, cells);
      if (operand.kind === "scalar") {
        return { kind: "scalar", value: -operand.value };
      }
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = -operand.values[i];
      return { kind: "samples", values: out };
    }

    case "funcCall":
      return evalFunc(expr.name, expr.args, results, varMap, n, cells);
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
      for (const dep of cellDeps(cell, varMap)) {
        visit(dep);
      }
    }
    order.push(a);
  }

  visit(addr);
  return order;
}

/** Evaluate a function call */
function evalFunc(
  name: string,
  argExprs: Expr[],
  results: Map<CellAddress, CellResult>,
  varMap: Map<string, CellAddress>,
  n: number,
  cells: Map<CellAddress, Cell>,
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
        evalCell(subAddr, subCell, freshResults, varMap, n, cells, true);
      }
    }
    return freshResults.get(targetAddr) ?? { kind: "scalar", value: 0 };
  }

  const args = argExprs.map((e) => evalExpr(e, results, varMap, n, cells));

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
    case "min":
      if (args.length !== 2) throw new Error("min(x, y) takes 2 arguments");
      return applyElementwise(args, Math.min, n);
    case "max":
      if (args.length !== 2) throw new Error("max(x, y) takes 2 arguments");
      return applyElementwise(args, Math.max, n);

    // Clamping
    case "clamp":
      if (args.length !== 3) throw new Error("clamp(x, lo, hi) takes 3 arguments");
      return applyElementwise(args, (x, lo, hi) => Math.min(Math.max(x, lo), hi), n);

    // Conditional: if(condition, then, else) — condition > 0 is truthy
    case "if":
      if (args.length !== 3) throw new Error("if(cond, then, else) takes 3 arguments");
      return applyElementwise(args, (c, t, e) => c > 0 ? t : e, n);

    // Distribution constructors — return sample arrays
    case "normal": {
      if (args.length !== 2) throw new Error("Normal(mean, std) takes 2 arguments");
      const [meanR, stdR] = args;
      if (meanR.kind !== "scalar" || stdR.kind !== "scalar")
        throw new Error("Normal() parameters must be scalars");
      return { kind: "samples", values: sample({ type: "Normal", mean: meanR.value, std: stdR.value }, n) };
    }
    case "lognormal": {
      if (args.length !== 2) throw new Error("LogNormal(mu, sigma) takes 2 arguments");
      const [muR, sigmaR] = args;
      if (muR.kind !== "scalar" || sigmaR.kind !== "scalar")
        throw new Error("LogNormal() parameters must be scalars");
      return { kind: "samples", values: sample({ type: "LogNormal", mu: muR.value, sigma: sigmaR.value }, n) };
    }
    case "uniform": {
      if (args.length !== 2) throw new Error("Uniform(low, high) takes 2 arguments");
      const [lowR, highR] = args;
      if (lowR.kind !== "scalar" || highR.kind !== "scalar")
        throw new Error("Uniform() parameters must be scalars");
      return { kind: "samples", values: sample({ type: "Uniform", low: lowR.value, high: highR.value }, n) };
    }
    case "triangular": {
      if (args.length !== 3) throw new Error("Triangular(low, mode, high) takes 3 arguments");
      const [tLow, tMode, tHigh] = args;
      if (tLow.kind !== "scalar" || tMode.kind !== "scalar" || tHigh.kind !== "scalar")
        throw new Error("Triangular() parameters must be scalars");
      return { kind: "samples", values: sample({ type: "Triangular", low: tLow.value, mode: tMode.value, high: tHigh.value }, n) };
    }
    case "beta": {
      if (args.length !== 2) throw new Error("Beta(alpha, beta) takes 2 arguments");
      const [alphaR, betaR] = args;
      if (alphaR.kind !== "scalar" || betaR.kind !== "scalar")
        throw new Error("Beta() parameters must be scalars");
      return { kind: "samples", values: sample({ type: "Beta", alpha: alphaR.value, beta: betaR.value }, n) };
    }

    // Bernoulli distribution — samples 0/1
    case "bernoulli": {
      if (args.length !== 1) throw new Error("bernoulli(p) takes 1 argument");
      const [pR] = args;
      if (pR.kind !== "scalar") throw new Error("bernoulli() parameter must be scalar");
      const p = pR.value;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.random() < p ? 1 : 0;
      return { kind: "samples", values: out };
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
        const u = Math.random() * cumsum; // normalize by cumsum to handle non-unit sums
        let j = 0;
        while (j < cdf.length - 1 && u >= cdf[j]) j++;
        out[i] = j;
      }
      return { kind: "samples", values: out };
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
): void {
  if (!tempOnly) cell.error = undefined;
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
      case "formula":
        result = evalExpr(cell.content.expr, results, varMap, numSamples, cells);
        break;
    }
  } catch (e) {
    if (!tempOnly) cell.error = (e as Error).message;
    result = undefined;
  }
  if (!tempOnly) {
    cell.result = result;
  }
  if (result) {
    results.set(addr, result);
  } else {
    results.delete(addr);
  }
}

/** Build reverse dependency map: for each cell, which cells depend on it? */
function buildReverseDeps(
  cells: Map<CellAddress, Cell>,
  varMap: Map<string, CellAddress>
): Map<CellAddress, Set<CellAddress>> {
  const rev = new Map<CellAddress, Set<CellAddress>>();
  for (const [addr, cell] of cells) {
    for (const dep of cellDeps(cell, varMap)) {
      let set = rev.get(dep);
      if (!set) {
        set = new Set();
        rev.set(dep, set);
      }
      set.add(addr);
    }
  }
  return rev;
}

/** Collect all downstream dependents of a set of dirty cells (BFS). */
function collectDirty(
  roots: CellAddress[],
  reverseDeps: Map<CellAddress, Set<CellAddress>>
): Set<CellAddress> {
  const dirty = new Set<CellAddress>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const addr = queue.shift()!;
    const dependents = reverseDeps.get(addr);
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

/**
 * Topological sort with cycle detection for bulk operations.
 * Returns { order, cycleAddrs } where cycleAddrs contains cells that are
 * part of or depend on a cycle.
 */
function topoSortWithCycles(
  cells: Map<CellAddress, Cell>,
  varMap: Map<string, CellAddress>
): { order: CellAddress[]; cycleAddrs: Set<CellAddress> } {
  const order: CellAddress[] = [];
  const visited = new Set<CellAddress>();
  const visiting = new Set<CellAddress>();
  const cycleAddrs = new Set<CellAddress>();

  function visit(addr: CellAddress): boolean {
    if (cycleAddrs.has(addr)) return false;
    if (visited.has(addr)) return true;
    if (visiting.has(addr)) {
      cycleAddrs.add(addr);
      return false;
    }
    visiting.add(addr);

    const cell = cells.get(addr);
    if (cell) {
      for (const dep of cellDeps(cell, varMap)) {
        if (!visit(dep)) {
          cycleAddrs.add(addr);
          visiting.delete(addr);
          return false;
        }
      }
    }

    visiting.delete(addr);
    visited.add(addr);
    order.push(addr);
    return true;
  }

  for (const addr of cells.keys()) {
    visit(addr);
  }

  return { order, cycleAddrs };
}

/**
 * Bulk recalculation with cycle detection — used when loading files or pasting.
 * Marks cells in cycles with errors, evaluates everything else.
 */
export function recalculateBulk(sheet: Sheet): void {
  const { varMap, dupAddrs } = buildVarMap(sheet.cells);
  const { order, cycleAddrs } = topoSortWithCycles(sheet.cells, varMap);
  const results = new Map<CellAddress, CellResult>();

  // Mark cycle cells with errors
  for (const addr of cycleAddrs) {
    const cell = sheet.cells.get(addr);
    if (cell) {
      cell.error = "Circular reference";
      cell.result = undefined;
    }
  }

  // Evaluate non-cycle cells in topological order (skip duplicates)
  for (const addr of order) {
    if (dupAddrs.has(addr)) continue;
    const cell = sheet.cells.get(addr)!;
    evalCell(addr, cell, results, varMap, sheet.numSamples, sheet.cells);
  }
}

/** Recalculate the entire sheet from scratch. */
export function recalculate(sheet: Sheet): void {
  const { varMap, dupAddrs } = buildVarMap(sheet.cells);
  const order = topoSort(sheet.cells, varMap);
  const results = new Map<CellAddress, CellResult>();

  for (const addr of order) {
    if (dupAddrs.has(addr)) continue;
    const cell = sheet.cells.get(addr)!;
    evalCell(addr, cell, results, varMap, sheet.numSamples, sheet.cells);
  }
}

/**
 * Incremental recalculation: only re-evaluate the changed cells and
 * their downstream dependents. Other cells keep their existing results.
 */
export function recalculateFrom(sheet: Sheet, changedAddrs: CellAddress[]): void {
  const { varMap, dupAddrs, clearedAddrs } = buildVarMap(sheet.cells);
  const reverseDeps = buildReverseDeps(sheet.cells, varMap);
  const dirty = collectDirty([...changedAddrs, ...clearedAddrs], reverseDeps);

  // We need the full topological order to know *which order* to eval the dirty cells
  const fullOrder = topoSort(sheet.cells, varMap);

  // Build a results map from existing (clean) cell results
  const results = new Map<CellAddress, CellResult>();
  for (const [addr, cell] of sheet.cells) {
    if (cell.result) {
      results.set(addr, cell.result);
    }
  }

  // Re-evaluate only dirty cells, in topological order (skip duplicates)
  for (const addr of fullOrder) {
    if (!dirty.has(addr)) continue;
    if (dupAddrs.has(addr)) continue;
    const cell = sheet.cells.get(addr)!;
    evalCell(addr, cell, results, varMap, sheet.numSamples, sheet.cells);
  }
}

/** Set a cell's raw value, parse it, and recalculate the sheet.
 *  Returns the cell, which will have an error set if the edit would create a cycle. */
export function setCellRaw(sheet: Sheet, addr: CellAddress, raw: string): Cell | undefined {
  if (raw.trim() === "") {
    sheet.cells.delete(addr);
    // Need to recalc anything that depended on this cell,
    // and the cell to the right if it uses labelVar
    const dirty = [addr];
    const parsed = parseAddress(addr);
    if (parsed) {
      const rightAddr = toAddress(parsed.col + 1, parsed.row);
      const rightCell = sheet.cells.get(rightAddr);
      if (rightCell?.labelVar) {
        dirty.push(rightAddr);
      }
    }
    recalculateFrom(sheet, dirty);
    return undefined;
  }

  const { content, variableName, labelVar } = parseCell(raw);
  const cell: Cell = { raw, content, variableName, labelVar };

  // Check for cycles before committing the edit
  if (content.kind === "formula") {
    // Temporarily put the new cell in so we can compute its deps
    const prev = sheet.cells.get(addr);
    sheet.cells.set(addr, cell);
    const { varMap } = buildVarMap(sheet.cells);
    const deps = cellDeps(cell, varMap);

    if (wouldCycle(addr, deps, sheet.cells, varMap)) {
      // Roll back — restore previous cell or remove
      if (prev) {
        sheet.cells.set(addr, prev);
      } else {
        sheet.cells.delete(addr);
      }
      cell.error = "Circular reference";
      cell.result = undefined;
      // Still put the errored cell in so the UI can display it
      sheet.cells.set(addr, cell);
      return cell;
    }
  }

  sheet.cells.set(addr, cell);

  // If this is a text cell, also dirty the cell to the right if it uses labelVar,
  // and any cells that referenced the old variable name
  const dirty = [addr];
  if (content.kind === "text" || content.kind === "empty") {
    const parsed = parseAddress(addr);
    if (parsed) {
      const rightAddr = toAddress(parsed.col + 1, parsed.row);
      const rightCell = sheet.cells.get(rightAddr);
      if (rightCell?.labelVar) {
        // Get the old variable name before rebuilding
        const oldVarName = rightCell.variableName;
        dirty.push(rightAddr);
        // Also dirty any cells that referenced the old variable name
        if (oldVarName) {
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

  recalculateFrom(sheet, dirty);
  return cell;
}

/** Create an empty sheet */
export function createSheet(numSamples = 10_000, name = "Untitled table"): Sheet {
  return { name, cells: new Map(), numSamples };
}

/** Compute summary stats from a CellResult */
export function summarize(result: CellResult): {
  mean: number;
  std: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
} {
  if (result.kind === "scalar") {
    return { mean: result.value, std: 0, p5: result.value, p25: result.value, p50: result.value, p75: result.value, p95: result.value };
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

  return { mean, std, p5: p(0.05), p25: p(0.25), p50: p(0.5), p75: p(0.75), p95: p(0.95) };
}

/** Compute histogram bins from samples.
 *  If fixedMin/fixedMax are provided, use that range instead of the data range.
 *  Samples outside the fixed range are clamped into the edge bins. */
export function histogram(
  result: CellResult,
  numBins = 50,
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
    min = Infinity;
    max = -Infinity;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] < min) min = vals[i];
      if (vals[i] > max) max = vals[i];
    }
  }

  if (min === max) {
    const bins = new Array(numBins).fill(0);
    bins[Math.floor(numBins / 2)] = vals.length;
    return { min: min - 1, max: max + 1, bins, binWidth: 2 / numBins };
  }

  const binWidth = (max - min) / numBins;
  const bins = new Array(numBins).fill(0);
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] < min || vals[i] > max) continue; // skip out-of-range samples
    let bin = Math.floor((vals[i] - min) / binWidth);
    if (bin >= numBins) bin = numBins - 1;
    bins[bin]++;
  }

  return { min, max, bins, binWidth };
}
