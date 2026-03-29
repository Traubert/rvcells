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
  const [guideMode, setGuideMode] = useState<GuideMode>("none");
  const [rangeUnit, setRangeUnit] = useState<"value" | "sigma" | "percentile">("value");

  function cycleGuideMode() {
    setGuideMode((m) => m === "none" ? "sigma" : m === "sigma" ? "percentiles" : "none");
  }

  function cycleRangeUnit() {
    setRangeUnit((m) => m === "value" ? "sigma" : m === "sigma" ? "percentile" : "value");
  }

  const guideModeLabel = guideMode === "none" ? "Guides: off" : guideMode === "sigma" ? "Guides: σ" : "Guides: P%";
  const rangeUnitLabel = rangeUnit === "value" ? "Range: value" : rangeUnit === "sigma" ? "Range: σ" : "Range: P%";

  /** Convert a natural value to the current display unit */
  function toDisplayUnit(v: number): number {
    if (rangeUnit === "sigma") {
      return stats.std > 0 ? (v - stats.mean) / stats.std : 0;
    }
    if (rangeUnit === "percentile") {
      // Approximate: what percentile does this value correspond to?
      // Use the sorted samples to find it
      if (result.kind !== "samples") return 50;
      const vals = result.values;
      let count = 0;
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] <= v) count++;
      }
      return (count / vals.length) * 100;
    }
    return v;
  }

  /** Convert a display unit value back to natural */
  function fromDisplayUnit(d: number): number {
    if (rangeUnit === "sigma") {
      return stats.mean + d * stats.std;
    }
    if (rangeUnit === "percentile") {
      // Find the value at the given percentile
      if (result.kind !== "samples") return stats.mean;
      const sorted = new Float64Array(result.values).sort();
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((d / 100) * (sorted.length - 1))));
      return sorted[idx];
    }
    return d;
  }

  /** Round display values appropriately for the unit */
  function roundDisplay(v: number): number {
    if (rangeUnit === "sigma") return Math.round(v * 100) / 100;
    if (rangeUnit === "percentile") return Math.round(v * 10) / 10;
    return roundForDisplay(v);
  }
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

      <div className="detail-body">
        <table className="detail-stats">
          <tbody>
            <tr><td>Mean</td><td>{formatNumber(stats.mean)}</td></tr>
            <tr><td>Std Dev</td><td>{formatNumber(stats.std)}</td></tr>
            <tr><td>P5</td><td>{formatNumber(stats.p5)}</td></tr>
            <tr><td>P25</td><td>{formatNumber(stats.p25)}</td></tr>
            <tr><td>P50</td><td>{formatNumber(stats.p50)}</td></tr>
            <tr><td>P75</td><td>{formatNumber(stats.p75)}</td></tr>
            <tr><td>P95</td><td>{formatNumber(stats.p95)}</td></tr>
          </tbody>
        </table>

        <div className="detail-chart">
          <Histogram hist={hist} maxBin={maxBin} stats={stats} guideMode={guideMode} />
        </div>

        <div className="detail-controls">
          <button className="hist-guide-toggle" onClick={cycleGuideMode}>{guideModeLabel}</button>
          <div className="detail-range-controls">
            <div className="lock-range-row">
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
                return offCentre ? (
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
                ) : null;
              })()}
            </div>
            {isLocked && (() => {
              const rangeCentre = (lockedRange.min + lockedRange.max) / 2;
              const rangeWidth = lockedRange.max - lockedRange.min;
              function zoomRange(factor: number) {
                const newHalf = (rangeWidth * factor) / 2;
                onLockRange({
                  min: roundForDisplay(rangeCentre - newHalf),
                  max: roundForDisplay(rangeCentre + newHalf),
                });
                onReturnFocus();
              }
              const displayMin = roundDisplay(toDisplayUnit(lockedRange.min));
              const displayMax = roundDisplay(toDisplayUnit(lockedRange.max));
              const displayStep = rangeUnit === "sigma" ? 0.5
                : rangeUnit === "percentile" ? 5
                : rangeStep;
              function handleDisplayInput(which: "min" | "max", value: string) {
                const num = Number(value);
                if (isNaN(num)) return;
                const natural = roundForDisplay(fromDisplayUnit(num));
                onLockRange({
                  ...lockedRange,
                  [which]: natural,
                });
              }
              function handleRangeBlur(e: React.FocusEvent) {
                // Only return focus to grid if focus is leaving the detail controls entirely
                const related = e.relatedTarget as HTMLElement | null;
                if (related?.closest(".detail-controls")) return;
                onReturnFocus();
              }
              function handleRangeKeyDown(e: React.KeyboardEvent) {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight"
                    || e.key === "Backspace" || e.key === "Delete"
                    || e.key === "ArrowUp" || e.key === "ArrowDown"
                    || e.key === "Tab") {
                  e.stopPropagation();
                }
                if (e.key === "Enter" || e.key === "Escape") {
                  onReturnFocus();
                }
              }
              return (
              <div className="range-locked-controls">
                <span className="zoom-buttons">
                  <button className="zoom-button" onClick={() => zoomRange(1 / 1.5)} title="Contract range">+</button>
                  <button className="zoom-button" onClick={() => zoomRange(1.5)} title="Expand range">−</button>
                </span>
                <button className="hist-guide-toggle" onClick={cycleRangeUnit}>{rangeUnitLabel}</button>
                <input
                  type="number"
                  className="range-input"
                  value={displayMin}
                  onChange={(e) => handleDisplayInput("min", e.target.value)}
                  onBlur={handleRangeBlur}
                  onKeyDown={handleRangeKeyDown}
                  step={displayStep}
                />
                <span className="range-separator">–</span>
                <input
                  type="number"
                  className="range-input"
                  value={displayMax}
                  onChange={(e) => handleDisplayInput("max", e.target.value)}
                  onBlur={handleRangeBlur}
                  onKeyDown={handleRangeKeyDown}
                  step={displayStep}
                />
              </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

type GuideMode = "none" | "sigma" | "percentiles";

interface GuideLine {
  value: number;
  label: string;
}

function getGuideLines(mode: GuideMode, stats: { mean: number; std: number; p5: number; p25: number; p50: number; p75: number; p95: number }): GuideLine[] {
  if (mode === "sigma") {
    return [
      { value: stats.mean - 3 * stats.std, label: "-3σ" },
      { value: stats.mean - 2 * stats.std, label: "-2σ" },
      { value: stats.mean - stats.std, label: "-1σ" },
      { value: stats.mean, label: "μ" },
      { value: stats.mean + stats.std, label: "+1σ" },
      { value: stats.mean + 2 * stats.std, label: "+2σ" },
      { value: stats.mean + 3 * stats.std, label: "+3σ" },
    ];
  }
  if (mode === "percentiles") {
    return [
      { value: stats.p5, label: "P5" },
      { value: stats.p25, label: "P25" },
      { value: stats.p50, label: "P50" },
      { value: stats.p75, label: "P75" },
      { value: stats.p95, label: "P95" },
    ];
  }
  return [];
}

function Histogram({ hist, maxBin, stats, guideMode }: {
  hist: { min: number; max: number; bins: number[]; binWidth: number };
  maxBin: number;
  stats: { mean: number; std: number; p5: number; p25: number; p50: number; p75: number; p95: number };
  guideMode: GuideMode;
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

  const guideLines = getGuideLines(guideMode, stats);
  const range = hist.max - hist.min;

  return (
    <div className="detail-histogram">
      <div className="hist-chart-area">
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
        {range > 0 && guideLines.map(({ value, label }) => {
          const pct = ((value - hist.min) / range) * 100;
          if (pct < 0 || pct > 100) return null;
          return (
            <div key={label} className="hist-guideline" style={{ left: `${pct}%` }}>
              <span className="hist-guideline-value">{formatNumber(value)}</span>
              <span className="hist-guideline-label">{label}</span>
            </div>
          );
        })}
      </div>
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

