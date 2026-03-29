import { useState, useCallback, useRef, useEffect } from "react";
import type { Sheet, CellAddress, Cell } from "../engine/types";
import { toAddress } from "../engine/types";
import { setCellRaw, summarize, recalculate, recalculateFrom } from "../engine/evaluate";
import { formatNumber } from "../format";
import { DetailPanel, type LockedRange } from "./DetailPanel";

const NUM_COLS = 26;
const NUM_ROWS = 50;

function colLabel(col: number): string {
  return String.fromCharCode(65 + col);
}

interface GridProps {
  sheet: Sheet;
  onSheetChange: () => void;
  onShowHelp?: () => void;
}

export function Grid({ sheet, onSheetChange, onShowHelp }: GridProps) {
  const [selectedAddr, setSelectedAddr] = useState<CellAddress | null>(null);
  const [editingAddr, setEditingAddr] = useState<CellAddress | null>(null);
  const [editValue, setEditValue] = useState("");
  const [lockedRange, setLockedRange] = useState<LockedRange | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingAddr && inputRef.current) {
      inputRef.current.focus();
    } else if (!editingAddr && gridRef.current) {
      gridRef.current.focus();
    }
  }, [editingAddr]);

  // Focus grid on mount
  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  const handleCellClick = useCallback(
    (addr: CellAddress) => {
      if (editingAddr && editingAddr !== addr) {
        if (inputRef.current) {
          setCellRaw(sheet, editingAddr, inputRef.current.value);
          setEditingAddr(null);
          onSheetChange();
        }
      }
      setSelectedAddr(addr);
    },
    [editingAddr, sheet, onSheetChange]
  );

  const handleCellDoubleClick = useCallback(
    (addr: CellAddress) => {
      setEditingAddr(addr);
      const cell = sheet.cells.get(addr);
      setEditValue(cell?.raw ?? "");
    },
    [sheet]
  );

  const commitEdit = useCallback(
    (addr: CellAddress, value: string) => {
      setCellRaw(sheet, addr, value);
      setEditingAddr(null);
      onSheetChange();
    },
    [sheet, onSheetChange]
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
        setEditingAddr(null);
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

  // Start editing when typing on a selected cell
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingAddr) return;

      // H: show help (works even without selection)
      if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey) {
        onShowHelp?.();
        e.preventDefault();
        return;
      }

      if (!selectedAddr) return;

      // Enter or F2: start editing existing content
      if (e.key === "Enter" || e.key === "F2") {
        setEditingAddr(selectedAddr);
        const cell = sheet.cells.get(selectedAddr);
        setEditValue(cell?.raw ?? "");
        e.preventDefault();
      }
      // = : start a new formula (clears cell, enters edit mode with "=")
      if (e.key === "=" && !e.ctrlKey && !e.metaKey) {
        setEditingAddr(selectedAddr);
        setEditValue("=");
        e.preventDefault();
      }
      // Arrow keys to move selection
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const match = selectedAddr.match(/^([A-Z]+)(\d+)$/);
        if (!match) return;
        let col = match[1].charCodeAt(0) - 65;
        let row = parseInt(match[2], 10) - 1;
        if (e.key === "ArrowUp") row = Math.max(0, row - 1);
        if (e.key === "ArrowDown") row = Math.min(NUM_ROWS - 1, row + 1);
        if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
        if (e.key === "ArrowRight") col = Math.min(NUM_COLS - 1, col + 1);
        setSelectedAddr(toAddress(col, row));
      }
      // Delete/Backspace to clear cell
      if (e.key === "Delete" || e.key === "Backspace") {
        setCellRaw(sheet, selectedAddr, "");
        onSheetChange();
        e.preventDefault();
      }
      // Shift+R: full recalculate everything
      if (e.key === "R" && e.shiftKey) {
        recalculate(sheet);
        onSheetChange();
        e.preventDefault();
      }
      // r: recalculate current cell and dependents
      if (e.key === "r" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        recalculateFrom(sheet, [selectedAddr]);
        onSheetChange();
        e.preventDefault();
      }
      // Escape: deselect
      if (e.key === "Escape") {
        setSelectedAddr(null);
        e.preventDefault();
      }
    },
    [editingAddr, selectedAddr, sheet, onSheetChange, onShowHelp]
  );

  return (
    <div className="grid-container" ref={gridRef} tabIndex={0} onKeyDown={handleGridKeyDown}>
      {/* Formula bar */}
      <div className="formula-bar">
        <span className="formula-bar-addr">{selectedAddr ?? ""}</span>
        <span className="formula-bar-var">
          {selectedAddr && sheet.cells.get(selectedAddr)?.variableName
            ? `(${sheet.cells.get(selectedAddr)!.variableName})`
            : ""}
        </span>
        <span className="formula-bar-content">
          {selectedAddr
            ? editingAddr === selectedAddr
              ? editValue
              : sheet.cells.get(selectedAddr)?.raw ?? ""
            : ""}
        </span>
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
                  const isSelected = addr === selectedAddr;
                  const isEditing = addr === editingAddr;

                  return (
                    <td
                      key={c}
                      className={`cell ${isSelected ? "selected" : ""} ${cell?.error ? "error" : ""} ${cell?.result?.kind === "samples" ? "has-distribution" : ""}`}
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
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail panel for selected cell — only for distributions */}
      {selectedAddr && sheet.cells.get(selectedAddr)?.result?.kind === "samples" && (
        <DetailPanel
          addr={selectedAddr}
          cell={sheet.cells.get(selectedAddr)!}
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

  // Interpolate from white (scalar-like) to distribution teal
  const r = Math.round(232 + (78 - 232) * uncertainty);   // e8 → 4e
  const g = Math.round(232 + (205 - 232) * uncertainty);  // e8 → cd
  const b = Math.round(248 + (196 - 248) * uncertainty);  // f8 → c4
  const color = `rgb(${r}, ${g}, ${b})`;

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
