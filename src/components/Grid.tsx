import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { Sheet, CellAddress, Cell } from "../engine/types";
import { toAddress, parseAddress } from "../engine/types";
import { setCellRaw, summarize, recalculateAll, recalculateAllFrom } from "../engine/evaluate";
import { formatNumber } from "../format";
import { shiftCellText } from "../engine/fill";
import { DetailPanel, type LockedRange } from "./DetailPanel";

/** Internal clipboard for copy/paste with reference shifting */
interface ClipboardData {
  originCol: number;
  originRow: number;
  grid: (string | null)[][]; // [row][col], null = empty cell
}

const NUM_COLS = 26;
const NUM_ROWS = 50;

function colLabel(col: number): string {
  return String.fromCharCode(65 + col);
}

/** Get the selection rectangle bounds, or null if no multi-selection */
function selectionBounds(
  active: CellAddress | null,
  anchor: CellAddress | null
): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null {
  if (!active || !anchor) return null;
  const a = parseAddress(active);
  const b = parseAddress(anchor);
  if (!a || !b) return null;
  if (a.col === b.col && a.row === b.row) return null; // single cell, no multi-select
  return {
    minCol: Math.min(a.col, b.col),
    maxCol: Math.max(a.col, b.col),
    minRow: Math.min(a.row, b.row),
    maxRow: Math.max(a.row, b.row),
  };
}

interface GridProps {
  sheet: Sheet;
  allSheets: Sheet[];
  sheetIndex: number;
  onSheetChange: () => void;
  onShowHelp?: () => void;
  onSave?: () => void;
  onOpen?: () => void;
}

export function Grid({ sheet, allSheets, sheetIndex, onSheetChange, onShowHelp, onSave, onOpen }: GridProps) {
  const [selectedAddr, setSelectedAddr] = useState<CellAddress | null>(null);
  // For multi-select: anchor is where shift-selection started, selectedAddr is the other corner
  const [selAnchor, setSelAnchor] = useState<CellAddress | null>(null);
  const [editingAddr, setEditingAddrRaw] = useState<CellAddress | null>(null);
  const [editingInBar, setEditingInBar] = useState(false);
  const [editValue, setEditValue] = useState("");

  function startEditing(addr: CellAddress, value: string, inBar: boolean) {
    setEditingAddrRaw(addr);
    setEditValue(value);
    setEditingInBar(inBar);
  }
  function stopEditing() {
    setEditingAddrRaw(null);
    setEditingInBar(false);
  }
  const [lockedRange, setLockedRange] = useState<LockedRange | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const barInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<ClipboardData | null>(null);

  useEffect(() => {
    if (editingAddr && !editingInBar && inputRef.current) {
      inputRef.current.focus();
    } else if (!editingAddr && gridRef.current) {
      gridRef.current.focus();
    }
    // Formula bar input focuses itself via autoFocus
  }, [editingAddr, editingInBar]);

  // Focus grid on mount
  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  // --- Fill handle drag ---
  const [fillDragTarget, setFillDragTarget] = useState<CellAddress | null>(null);
  const fillOriginRef = useRef<{ col: number; row: number } | null>(null);

  const handleFillMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedAddr) return;
      if (!sheet.cells.has(selectedAddr)) return;
      const origin = parseAddress(selectedAddr);
      if (!origin) return;
      fillOriginRef.current = origin;
      setFillDragTarget(null);

      const handleMouseMove = (ev: MouseEvent) => {
        const td = (ev.target as HTMLElement).closest("td[data-addr]") as HTMLElement | null;
        if (td?.dataset.addr) {
          setFillDragTarget(td.dataset.addr);
        }
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);

        const td = (ev.target as HTMLElement).closest("td[data-addr]") as HTMLElement | null;
        const targetAddr = td?.dataset.addr ?? fillDragTarget;
        if (!targetAddr || !fillOriginRef.current || targetAddr === selectedAddr) {
          setFillDragTarget(null);
          fillOriginRef.current = null;
          return;
        }

        const target = parseAddress(targetAddr);
        if (!target) return;
        const orig = fillOriginRef.current;
        const sourceCell = sheet.cells.get(selectedAddr);
        if (!sourceCell) return;

        // Determine fill direction: use the axis with the larger delta
        const dCol = target.col - orig.col;
        const dRow = target.row - orig.row;

        if (Math.abs(dRow) >= Math.abs(dCol)) {
          // Fill vertically
          const step = dRow > 0 ? 1 : -1;
          for (let r = orig.row + step; step > 0 ? r <= target.row : r >= target.row; r += step) {
            const shifted = shiftCellText(sourceCell.raw, 0, r - orig.row);
            setCellRaw(sheet, toAddress(orig.col, r), shifted, allSheets, sheetIndex);
          }
        } else {
          // Fill horizontally
          const step = dCol > 0 ? 1 : -1;
          for (let c = orig.col + step; step > 0 ? c <= target.col : c >= target.col; c += step) {
            const shifted = shiftCellText(sourceCell.raw, c - orig.col, 0);
            setCellRaw(sheet, toAddress(c, orig.row), shifted, allSheets, sheetIndex);
          }
        }

        setFillDragTarget(null);
        fillOriginRef.current = null;
        onSheetChange();
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [selectedAddr, sheet, onSheetChange]
  );

  // Compute fill preview range for highlighting — only when actively dragging
  const fillPreviewAddrs = useMemo(() => {
    if (!fillDragTarget || !selectedAddr || !fillOriginRef.current) return null;
    const orig = fillOriginRef.current;
    const target = parseAddress(fillDragTarget);
    if (!target) return null;
    const set = new Set<CellAddress>();
    const dCol = target.col - orig.col;
    const dRow = target.row - orig.row;
    if (Math.abs(dRow) >= Math.abs(dCol)) {
      const step = dRow > 0 ? 1 : -1;
      for (let r = orig.row + step; step > 0 ? r <= target.row : r >= target.row; r += step) {
        set.add(toAddress(orig.col, r));
      }
    } else {
      const step = dCol > 0 ? 1 : -1;
      for (let c = orig.col + step; step > 0 ? c <= target.col : c >= target.col; c += step) {
        set.add(toAddress(c, orig.row));
      }
    }
    return set;
  }, [fillDragTarget, selectedAddr]);

  const handleCellClick = useCallback(
    (addr: CellAddress) => {
      if (editingAddr && editingAddr !== addr) {
        // Commit from whichever input is active
        const value = editingInBar
          ? barInputRef.current?.value ?? editValue
          : inputRef.current?.value ?? editValue;
        setCellRaw(sheet, editingAddr, value, allSheets, sheetIndex);
        stopEditing();
        onSheetChange();
      }
      setSelectedAddr(addr);
      setSelAnchor(null); // clear multi-selection on click
    },
    [editingAddr, sheet, allSheets, sheetIndex, onSheetChange]
  );

  const handleCellDoubleClick = useCallback(
    (addr: CellAddress) => {
      const cell = sheet.cells.get(addr);
      startEditing(addr, cell?.raw ?? "", false);
    },
    [sheet]
  );

  const commitEdit = useCallback(
    (addr: CellAddress, value: string) => {
      setCellRaw(sheet, addr, value, allSheets, sheetIndex);
      stopEditing();
      onSheetChange();
    },
    [sheet, allSheets, sheetIndex, onSheetChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, addr: CellAddress) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit(addr, e.currentTarget.value);
        // Move selection down
        const match = addr.match(/^([A-Z]+)(\d+)$/);
        if (match) {
          const nextRow = parseInt(match[2], 10) + 1;
          if (nextRow <= NUM_ROWS) {
            setSelectedAddr(match[1] + nextRow);
          }
        }
      } else if (e.key === "Escape") {
        stopEditing();
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit(addr, e.currentTarget.value);
        // Move selection right
        const match = addr.match(/^([A-Z]+)(\d+)$/);
        if (match) {
          const col = match[1].charCodeAt(0) - 65;
          if (col + 1 < NUM_COLS) {
            setSelectedAddr(String.fromCharCode(66 + col) + match[2]);
          }
        }
      }
    },
    [commitEdit]
  );

  /** Get the effective selection bounds (single cell or multi-select) */
  const getSelectionRange = useCallback(() => {
    if (!selectedAddr) return null;
    const bounds = selectionBounds(selectedAddr, selAnchor);
    if (bounds) return bounds;
    const parsed = parseAddress(selectedAddr);
    if (!parsed) return null;
    return { minCol: parsed.col, maxCol: parsed.col, minRow: parsed.row, maxRow: parsed.row };
  }, [selectedAddr, selAnchor]);

  /** Format a cell's resolved value for clipboard */
  function resolvedValue(cell: Cell | undefined): string {
    if (!cell?.result) {
      if (cell?.content.kind === "text") return cell.content.value;
      return "";
    }
    if (cell.result.kind === "scalar") return formatNumber(cell.result.value);
    const stats = summarize(cell.result);
    return `${formatNumber(stats.mean)} ± ${formatNumber(stats.std)}`;
  }

  /** Copy/cut selected cells */
  const copySelection = useCallback((cut: boolean, resolved: boolean) => {
    const range = getSelectionRange();
    if (!range) return;

    const rows: string[][] = [];
    const rawGrid: (string | null)[][] = [];
    for (let r = range.minRow; r <= range.maxRow; r++) {
      const row: string[] = [];
      const rawRow: (string | null)[] = [];
      for (let c = range.minCol; c <= range.maxCol; c++) {
        const addr = toAddress(c, r);
        const cell = sheet.cells.get(addr);
        if (resolved) {
          row.push(resolvedValue(cell));
        } else {
          row.push(cell?.raw ?? "");
        }
        rawRow.push(cell?.raw ?? null);
      }
      rows.push(row);
      rawGrid.push(rawRow);
    }

    // Write TSV to system clipboard
    const tsv = rows.map((r) => r.join("\t")).join("\n");
    navigator.clipboard.writeText(tsv).catch(() => {});

    // Save internal clipboard for reference shifting (only for non-resolved copy)
    if (!resolved) {
      clipboardRef.current = {
        originCol: range.minCol,
        originRow: range.minRow,
        grid: rawGrid,
      };
    } else {
      clipboardRef.current = null;
    }

    // Cut: clear source cells
    if (cut) {
      for (let r = range.minRow; r <= range.maxRow; r++) {
        for (let c = range.minCol; c <= range.maxCol; c++) {
          setCellRaw(sheet, toAddress(c, r), "", allSheets, sheetIndex);
        }
      }
      onSheetChange();
    }
  }, [getSelectionRange, sheet, allSheets, sheetIndex, onSheetChange]);

  /** Handle native paste event — reliable access to system clipboard */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (editingAddr) return; // let normal paste work in input fields
    if (!selectedAddr) return;
    e.preventDefault();

    const target = parseAddress(selectedAddr);
    if (!target) return;

    const internal = clipboardRef.current;
    const systemText = e.clipboardData.getData("text/plain");

    // Use internal clipboard if we have one and the system clipboard matches
    // (i.e. the user copied from rvcells, not from another app)
    const internalTsv = internal
      ? internal.grid.map((r) => r.map((c) => c ?? "").join("\t")).join("\n")
      : null;

    if (internal && internalTsv === systemText) {
      // Internal paste with reference shifting
      const dCol = target.col - internal.originCol;
      const dRow = target.row - internal.originRow;
      for (let r = 0; r < internal.grid.length; r++) {
        for (let c = 0; c < internal.grid[r].length; c++) {
          const raw = internal.grid[r][c];
          if (raw === null) continue;
          const shifted = shiftCellText(raw, dCol, dRow);
          setCellRaw(sheet, toAddress(target.col + c, target.row + r), shifted, allSheets, sheetIndex);
        }
      }
    } else if (systemText) {
      // External paste — parse TSV
      const rows = systemText.split("\n").map((line) => line.split("\t"));
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const val = rows[r][c];
          if (val === undefined) continue;
          setCellRaw(sheet, toAddress(target.col + c, target.row + r), val, allSheets, sheetIndex);
        }
      }
    }
    onSheetChange();
  }, [editingAddr, selectedAddr, sheet, allSheets, sheetIndex, onSheetChange]);

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+S: save (works even while editing)
      if (ctrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave?.();
        return;
      }
      // Ctrl+O: open (works even while editing)
      if (ctrl && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onOpen?.();
        return;
      }

      if (editingAddr) return;

      if (!selectedAddr) return;

      // Enter or F2: start editing existing content (single selection only)
      if (e.key === "Enter" || e.key === "F2") {
        if (!selAnchor) {
          const cell = sheet.cells.get(selectedAddr);
          startEditing(selectedAddr, cell?.raw ?? "", false);
        }
        e.preventDefault();
        return;
      }
      // Arrow keys: plain = move + clear multi-select, shift = extend selection
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const parsed = parseAddress(selectedAddr);
        if (!parsed) return;
        let { col, row } = parsed;
        if (e.key === "ArrowUp") row = Math.max(0, row - 1);
        if (e.key === "ArrowDown") row = Math.min(NUM_ROWS - 1, row + 1);
        if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
        if (e.key === "ArrowRight") col = Math.min(NUM_COLS - 1, col + 1);
        const newAddr = toAddress(col, row);
        setSelectedAddr(newAddr);
        if (e.shiftKey) {
          if (!selAnchor) setSelAnchor(selectedAddr);
        } else {
          setSelAnchor(null);
        }
        return;
      }
      // Delete/Backspace: clear selected cell(s)
      if (e.key === "Delete" || e.key === "Backspace") {
        const bounds = selectionBounds(selectedAddr, selAnchor);
        if (bounds) {
          for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
              setCellRaw(sheet, toAddress(c, r), "", allSheets, sheetIndex);
            }
          }
        } else {
          setCellRaw(sheet, selectedAddr, "", allSheets, sheetIndex);
        }
        setSelAnchor(null);
        onSheetChange();
        e.preventDefault();
        return;
      }
      // Escape: clear multi-selection first, then deselect
      if (e.key === "Escape") {
        if (selAnchor) {
          setSelAnchor(null);
        } else {
          setSelectedAddr(null);
        }
        e.preventDefault();
        return;
      }
      // Ctrl+C / Ctrl+Shift+C: copy (shift = resolved values)
      if (ctrl && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection(false, e.shiftKey);
        return;
      }
      // Ctrl+X / Ctrl+Shift+X: cut (shift = resolved values)
      if (ctrl && e.key.toLowerCase() === "x") {
        e.preventDefault();
        copySelection(true, e.shiftKey);
        return;
      }
      // Ctrl+H: help
      if (ctrl && e.key.toLowerCase() === "h") {
        onShowHelp?.();
        e.preventDefault();
        return;
      }
      // Ctrl+V: handled by onPaste event (don't preventDefault here)
      if (ctrl && e.key.toLowerCase() === "v") {
        return;
      }
      // Ctrl+R: recalculate current cell and dependents
      if (ctrl && e.key.toLowerCase() === "r" && !e.shiftKey) {
        recalculateAllFrom(allSheets, sheetIndex, [selectedAddr]);
        onSheetChange();
        e.preventDefault();
        return;
      }
      // Ctrl+Shift+R: full recalculate everything
      if (ctrl && e.key.toLowerCase() === "r" && e.shiftKey) {
        recalculateAll(allSheets);
        onSheetChange();
        e.preventDefault();
        return;
      }
      // Direct typing: printable character starts editing the cell
      if (!ctrl && !e.altKey && e.key.length === 1 && !selAnchor) {
        startEditing(selectedAddr, e.key, false);
        e.preventDefault();
        return;
      }
    },
    [editingAddr, selectedAddr, selAnchor, sheet, allSheets, sheetIndex, onSheetChange, copySelection, onSave, onOpen]
  );

  const selBounds = selectionBounds(selectedAddr, selAnchor);
  const isMultiSelect = selBounds !== null;

  return (
    <div className="grid-container" ref={gridRef} tabIndex={0} onKeyDown={handleGridKeyDown} onPaste={handlePaste}>
      {/* Formula bar */}
      <div className="formula-bar">
        <span className="formula-bar-addr">{selectedAddr ?? ""}</span>
        <span className="formula-bar-var">
          {selectedAddr && sheet.cells.get(selectedAddr)?.variableName
            ? `(${sheet.cells.get(selectedAddr)!.variableName})`
            : ""}
        </span>
        {editingAddr === selectedAddr && editingInBar && selectedAddr ? (
          <input
            ref={barInputRef}
            className="formula-bar-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitEdit(selectedAddr, e.currentTarget.value);
              } else if (e.key === "Escape") {
                stopEditing();
              }
              e.stopPropagation();
            }}
            onBlur={(e) => commitEdit(selectedAddr, e.currentTarget.value)}
            autoFocus
          />
        ) : (
          <span
            className="formula-bar-content"
            onClick={() => {
              if (selectedAddr) {
                const cell = sheet.cells.get(selectedAddr);
                startEditing(selectedAddr, cell?.raw ?? "", true);
              }
            }}
          >
            {selectedAddr
              ? editingAddr === selectedAddr
                ? editValue
                : sheet.cells.get(selectedAddr)?.raw ?? ""
              : ""}
          </span>
        )}
      </div>

      <div className="grid-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th className="row-header"></th>
              {Array.from({ length: NUM_COLS }, (_, c) => (
                <th key={c} className="col-header">
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: NUM_ROWS }, (_, r) => (
              <tr key={r}>
                <td className="row-header">{r + 1}</td>
                {Array.from({ length: NUM_COLS }, (_, c) => {
                  const addr = toAddress(c, r);
                  const cell = sheet.cells.get(addr);
                  const isActive = addr === selectedAddr;
                  const isEditing = addr === editingAddr;
                  const inSel = selBounds && c >= selBounds.minCol && c <= selBounds.maxCol && r >= selBounds.minRow && r <= selBounds.maxRow;

                  return (
                    <td
                      key={c}
                      data-addr={addr}
                      className={`cell ${isActive ? "selected" : ""} ${inSel && !isActive ? "in-selection" : ""} ${cell?.error ? "error" : ""} ${cell?.result?.kind === "samples" ? "has-distribution" : ""}${fillPreviewAddrs?.has(addr) ? " fill-preview" : ""}`}
                      onClick={() => handleCellClick(addr)}
                      onDoubleClick={() => handleCellDoubleClick(addr)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="cell-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, addr)}
                          onBlur={(e) => commitEdit(addr, e.currentTarget.value)}
                        />
                      ) : (
                        <CellDisplay cell={cell} />
                      )}
                      {isActive && !isEditing && !isMultiSelect && cell && (
                        <div
                          className="fill-handle"
                          onMouseDown={handleFillMouseDown}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail panel for selected cell — only for single distribution selection */}
      {selectedAddr && !isMultiSelect && sheet.cells.get(selectedAddr)?.result?.kind === "samples" && (
        <DetailPanel
          addr={selectedAddr}
          cell={sheet.cells.get(selectedAddr)!}
          allSheets={allSheets}
          sheetIndex={sheetIndex}
          lockedRange={lockedRange}
          onLockRange={setLockedRange}
          onReturnFocus={() => gridRef.current?.focus()}
        />
      )}
    </div>
  );
}

function CellDisplay({ cell }: { cell: Cell | undefined }) {
  if (!cell || cell.content.kind === "empty") {
    return null;
  }

  if (cell.error) {
    return <span className="cell-error" title={cell.error}>⚠ {cell.error}</span>;
  }

  if (!cell.result) {
    if (cell.content.kind === "text") {
      return <span className="cell-text">{cell.content.value}</span>;
    }
    return null;
  }

  if (cell.result.kind === "scalar") {
    return <span className="cell-scalar">{formatNumber(cell.result.value)}</span>;
  }

  // Distribution result — show mean ± std, color intensity reflects uncertainty
  const stats = summarize(cell.result);
  const uncertainty = uncertaintyFraction(stats.mean, stats.std);

  // Two-stop color ramp: white → warm orange (u=0.5) → angry red (u=1.0)
  const u = uncertainty;
  let r_, g_, b_;
  if (u <= 0.5) {
    const t = u * 2; // 0→1 over first half
    r_ = Math.round(232 + (230 - 232) * t);  // e8 → e6
    g_ = Math.round(232 + (130 - 232) * t);  // e8 → 82
    b_ = Math.round(248 + (60 - 248) * t);   // f8 → 3c
  } else {
    const t = (u - 0.5) * 2; // 0→1 over second half
    r_ = Math.round(230 + (220 - 230) * t);  // e6 → dc
    g_ = Math.round(130 + (50 - 130) * t);   // 82 → 32
    b_ = Math.round(60 + (45 - 60) * t);     // 3c → 2d
  }
  const color = `rgb(${r_}, ${g_}, ${b_})`;

  return (
    <span className="cell-distribution" style={{ color }} title={`P5: ${formatNumber(stats.p5)} | P95: ${formatNumber(stats.p95)}`}>
      {formatNumber(stats.mean)}
      <span className="cell-spread" style={{ opacity: 0.3 + 0.7 * uncertainty }}> ±{formatNumber(stats.std)}</span>
    </span>
  );
}

/**
 * Map uncertainty to [0, 1]. Uses coefficient of variation (std/|mean|)
 * but falls back to a spread-based measure when mean is near zero.
 */
function uncertaintyFraction(mean: number, std: number): number {
  if (std === 0) return 0;
  const absMean = Math.abs(mean);
  const cv = absMean > std * 0.1 ? std / absMean : 1;
  // Steeper curve: cv=0.05 → ~0.33, cv=0.1 → ~0.5, cv=0.3 → ~0.8, cv≥0.5 → ~1
  return Math.min(1, 1 - 1 / (1 + 6 * cv));
}
