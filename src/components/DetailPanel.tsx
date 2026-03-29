import { useMemo, useState, useCallback, useRef } from "react";
import type { Cell } from "../engine/types";
import { summarize, histogram } from "../engine/evaluate";
import { formatNumber } from "../format";

export interface LockedRange {
  min: number;
  max: number;
}

interface DetailPanelProps {
  addr: string;
  cell: Cell;
  lockedRange: LockedRange | null;
  onLockRange: (range: LockedRange | null) => void;
  onReturnFocus: () => void;
}

export function DetailPanel({ addr, cell, lockedRange, onLockRange, onReturnFocus }: DetailPanelProps) {
  const result = cell.result;
  if (!result) return null;

  const stats = useMemo(() => summarize(result), [result]);
  const autoHist = useMemo(() => histogram(result, 60), [result]);
  const hist = useMemo(
    () =>
      lockedRange
        ? histogram(result, 60, lockedRange.min, lockedRange.max)
        : autoHist,
    [result, lockedRange, autoHist]
  );

  const maxBin = Math.max(...hist.bins);
  const isLocked = lockedRange !== null;

  /** Round to a reasonable number of significant figures for display/input */
  function roundForDisplay(n: number): number {
    if (n === 0) return 0;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 3);
    return Math.round(n / magnitude) * magnitude;
  }

  function handleLockToggle() {
    if (isLocked) {
      onLockRange(null);
    } else {
      onLockRange({
        min: roundForDisplay(autoHist.min),
        max: roundForDisplay(autoHist.max),
      });
    }
  }

  function handleRangeInput(which: "min" | "max", value: string) {
    const num = Number(value);
    if (isNaN(num) || !lockedRange) return;
    onLockRange({
      ...lockedRange,
      [which]: num,
    });
  }

  // Compute a step that's ~1% of the range
  const rangeStep = isLocked
    ? Math.pow(10, Math.floor(Math.log10(Math.abs(lockedRange.max - lockedRange.min))) - 1)
    : 1;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-addr">{addr}</span>
        {cell.variableName && (
          <span className="detail-var">{cell.variableName}</span>
        )}
        <span className="detail-raw">{cell.raw}</span>
      </div>

      <Histogram hist={hist} maxBin={maxBin} />

      <div className="detail-range-controls">
        <label className="lock-range-label">
          <input
            type="checkbox"
            checked={isLocked}
            onChange={() => { handleLockToggle(); onReturnFocus(); }}
          />
          Lock range
        </label>
        {isLocked && (() => {
          const rangeCentre = (lockedRange.min + lockedRange.max) / 2;
          const rangeWidth = lockedRange.max - lockedRange.min;
          const offCentre = rangeWidth > 0 && Math.abs(stats.p50 - rangeCentre) / rangeWidth > 0.001;
          function zoomRange(factor: number) {
            const newHalf = (rangeWidth * factor) / 2;
            onLockRange({
              min: roundForDisplay(rangeCentre - newHalf),
              max: roundForDisplay(rangeCentre + newHalf),
            });
            onReturnFocus();
          }
          return (
          <span className="range-inputs">
            <span className="zoom-buttons">
              <button className="zoom-button" onClick={() => zoomRange(1 / 1.5)} title="Contract range">+</button>
              <button className="zoom-button" onClick={() => zoomRange(1.5)} title="Expand range">−</button>
            </span>
            <input
              type="number"
              className="range-input"
              value={lockedRange.min}
              onChange={(e) => handleRangeInput("min", e.target.value)}
              onBlur={onReturnFocus}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onReturnFocus(); }}
              step={rangeStep}
            />
            <span className="range-separator">–</span>
            <input
              type="number"
              className="range-input"
              value={lockedRange.max}
              onChange={(e) => handleRangeInput("max", e.target.value)}
              onBlur={onReturnFocus}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") onReturnFocus(); }}
              step={rangeStep}
            />
            {offCentre && (
              <button
                className="range-button"
                onClick={() => {
                  const halfWidth = rangeWidth / 2;
                  onLockRange({
                    min: roundForDisplay(stats.p50 - halfWidth),
                    max: roundForDisplay(stats.p50 + halfWidth),
                  });
                  onReturnFocus();
                }}
                title="Centre range on current cell's median"
              >
                Recentre
              </button>
            )}
          </span>
          );
        })()}
      </div>

      <table className="detail-stats">
        <tbody>
          <tr><td>Mean</td><td>{formatNumber(stats.mean)}</td></tr>
          <tr><td>Std Dev</td><td>{formatNumber(stats.std)}</td></tr>
          <tr><td>P5</td><td>{formatNumber(stats.p5)}</td></tr>
          <tr><td>P25</td><td>{formatNumber(stats.p25)}</td></tr>
          <tr><td>P50 (median)</td><td>{formatNumber(stats.p50)}</td></tr>
          <tr><td>P75</td><td>{formatNumber(stats.p75)}</td></tr>
          <tr><td>P95</td><td>{formatNumber(stats.p95)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function Histogram({ hist, maxBin }: {
  hist: { min: number; max: number; bins: number[]; binWidth: number };
  maxBin: number;
}) {
  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const totalSamples = useMemo(() => hist.bins.reduce((a, b) => a + b, 0), [hist.bins]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const bin = Math.floor(x * hist.bins.length);
    if (bin >= 0 && bin < hist.bins.length) {
      setHoverBin(bin);
    } else {
      setHoverBin(null);
    }
  }, [hist.bins.length]);

  const handleMouseLeave = useCallback(() => setHoverBin(null), []);

  const hoverInfo = hoverBin !== null ? {
    lo: hist.min + hoverBin * hist.binWidth,
    hi: hist.min + (hoverBin + 1) * hist.binWidth,
    pct: totalSamples > 0 ? (hist.bins[hoverBin] / totalSamples) * 100 : 0,
  } : null;

  return (
    <div className="detail-histogram">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${hist.bins.length} 100`}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {hist.bins.map((count, i) => (
          <rect
            key={i}
            x={i}
            y={maxBin > 0 ? 100 - (count / maxBin) * 100 : 100}
            width={0.9}
            height={maxBin > 0 ? (count / maxBin) * 100 : 0}
            className={`hist-bar ${i === hoverBin ? "hist-bar-hover" : ""}`}
          />
        ))}
      </svg>
      <div className="hist-axis">
        <span>{formatNumber(hist.min)}</span>
        {hoverInfo && (
          <span className="hist-hover-info">
            {formatNumber(hoverInfo.lo)}–{formatNumber(hoverInfo.hi)}: {hoverInfo.pct.toFixed(1)}%
          </span>
        )}
        <span>{formatNumber(hist.max)}</span>
      </div>
    </div>
  );
}

