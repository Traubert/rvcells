import { useMemo, useState, useCallback, useRef } from "react";
import type { Cell, Sheet } from "../engine/types";
import { summarize, histogram, collectInputs, spearmanCorrelation, computeTornado, type SensitivityInput } from "../engine/evaluate";
import { formatNumber } from "../format";

export interface LockedRange {
  min: number;
  max: number;
}

type DetailTab = "distribution" | "correlation" | "variance" | "tornado";

interface DetailPanelProps {
  addr: string;
  cell: Cell;
  allSheets: Sheet[];
  sheetIndex: number;
  lockedRange: LockedRange | null;
  onLockRange: (range: LockedRange | null) => void;
  onReturnFocus: () => void;
}

export function DetailPanel({ addr, cell, allSheets, sheetIndex, lockedRange, onLockRange, onReturnFocus }: DetailPanelProps) {
  const result = cell.result;
  if (!result) return null;

  const [activeTab, setActiveTab] = useState<DetailTab>("distribution");

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

  // Compute a step that's ~1% of the range
  const rangeStep = isLocked
    ? Math.pow(10, Math.floor(Math.log10(Math.abs(lockedRange.max - lockedRange.min))) - 1)
    : 1;

  // Check if the cell is a formula (sensitivity/tornado only make sense for formulas)
  const isFormula = cell.content.kind === "formula";

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className="detail-addr">{addr}</span>
        {cell.variableName && (
          <span className="detail-var">{cell.variableName}</span>
        )}
        <span className="detail-raw">{cell.raw}</span>
        {isFormula && (
          <div className="detail-tabs">
            <button
              className={`detail-tab ${activeTab === "distribution" ? "detail-tab-active" : ""}`}
              onClick={() => setActiveTab("distribution")}
            >
              Distribution
            </button>
            <button
              className={`detail-tab ${activeTab === "correlation" ? "detail-tab-active" : ""}`}
              onClick={() => setActiveTab("correlation")}
            >
              Correlation
            </button>
            <button
              className={`detail-tab ${activeTab === "variance" ? "detail-tab-active" : ""}`}
              onClick={() => setActiveTab("variance")}
            >
              Variance
            </button>
            <button
              className={`detail-tab ${activeTab === "tornado" ? "detail-tab-active" : ""}`}
              onClick={() => setActiveTab("tornado")}
            >
              Tornado
            </button>
          </div>
        )}
      </div>

      {activeTab === "distribution" && (
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
      )}

      {activeTab === "correlation" && isFormula && (
        <SensitivityView
          outputResult={result}
          allSheets={allSheets}
          sheetIndex={sheetIndex}
          addr={addr}
        />
      )}

      {activeTab === "variance" && isFormula && (
        <VarianceView
          outputResult={result}
          allSheets={allSheets}
          sheetIndex={sheetIndex}
          addr={addr}
        />
      )}

      {activeTab === "tornado" && isFormula && (
        <TornadoView
          allSheets={allSheets}
          sheetIndex={sheetIndex}
          addr={addr}
          outputResult={result}
        />
      )}
    </div>
  );
}

// ─── Sensitivity view ────────────────────────────────────────────────

interface AnalysisViewProps {
  outputResult: import("../engine/types").CellResult;
  allSheets: Sheet[];
  sheetIndex: number;
  addr: string;
}

function SensitivityView({ outputResult, allSheets, sheetIndex, addr }: AnalysisViewProps) {
  const inputs = useMemo(
    () => collectInputs(addr, sheetIndex, allSheets),
    [addr, sheetIndex, allSheets, outputResult]
  );

  const correlations = useMemo(() => {
    if (outputResult.kind !== "samples") return [];
    return inputs
      .filter((inp) => !inp.isScalar)
      .map((inp) => ({
        ...inp,
        correlation: inp.result.kind === "samples"
          ? spearmanCorrelation(inp.result.values, outputResult.values)
          : 0,
      }))
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }, [inputs, outputResult]);

  if (correlations.length === 0) {
    return <div className="detail-body"><span className="detail-empty">No distribution inputs found</span></div>;
  }

  const maxAbs = Math.max(...correlations.map((c) => Math.abs(c.correlation)), 0.01);

  return (
    <div className="detail-body">
      <div className="analysis-scroll">
        <table className="sensitivity-table">
          <thead>
            <tr>
              <th className="sens-label-col">Input</th>
              <th className="sens-bar-col">Spearman's rank correlation coefficient</th>
              <th className="sens-value-col">r</th>
            </tr>
          </thead>
          <tbody>
            {correlations.map((c, i) => {
              const pct = (Math.abs(c.correlation) / maxAbs) * 50;
              const isPositive = c.correlation >= 0;
              return (
                <tr key={`cell-${i}`}>
                  <td className="sens-label" title={c.detail}>
                    {c.label}
                  </td>
                  <td className="sens-bar-cell">
                    <div className="sens-bar-track">
                      <div
                        className={`sens-bar ${isPositive ? "sens-bar-pos" : "sens-bar-neg"}`}
                        style={{
                          width: `${pct}%`,
                          [isPositive ? "left" : "right"]: "50%",
                        }}
                      />
                      <div className="sens-bar-center" />
                    </div>
                  </td>
                  <td className="sens-value">
                    {c.correlation >= 0 ? "+" : ""}{c.correlation.toFixed(3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tornado view ────────────────────────────────────────────────────

function VarianceView({ outputResult, allSheets, sheetIndex, addr }: AnalysisViewProps) {
  const inputs = useMemo(
    () => collectInputs(addr, sheetIndex, allSheets),
    [addr, sheetIndex, allSheets, outputResult]
  );

  const contributions = useMemo(() => {
    if (outputResult.kind !== "samples") return [];
    return inputs
      .map((inp) => {
        if (inp.isScalar || inp.result.kind !== "samples") {
          return { ...inp, contribution: 0 };
        }
        const r = spearmanCorrelation(inp.result.values, outputResult.values);
        return { ...inp, contribution: r * r };
      })
      .sort((a, b) => b.contribution - a.contribution);
  }, [inputs, outputResult]);

  if (contributions.length === 0) {
    return <div className="detail-body"><span className="detail-empty">No inputs found</span></div>;
  }

  const maxContrib = Math.max(...contributions.map((c) => c.contribution), 0.01);

  return (
    <div className="detail-body">
      <div className="analysis-scroll">
        <table className="tornado-table">
          <thead>
            <tr>
              <th className="tornado-label-col">Input</th>
              <th className="tornado-bar-col">Variance contribution</th>
              <th className="tornado-value-col">r²</th>
            </tr>
          </thead>
          <tbody>
            {contributions.map((c, i) => {
              const pct = (c.contribution / maxContrib) * 100;
              return (
                <tr key={`${i}`} className={c.isScalar ? "tornado-scalar" : ""}>
                  <td className="tornado-label" title={c.detail}>
                    {c.label}
                    {c.isScalar && <span className="tornado-scalar-tag"> (scalar)</span>}
                  </td>
                  <td className="tornado-bar-cell">
                    {!c.isScalar && (
                      <div className="tornado-bar-track">
                        <div
                          className="tornado-bar variance-bar"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="tornado-value">
                    {c.isScalar ? "—" : c.contribution.toFixed(3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tornado view (proper: ±1σ one-at-a-time) ───────────────────────

function TornadoView({ allSheets, sheetIndex, addr, outputResult }: { allSheets: Sheet[]; sheetIndex: number; addr: string; outputResult: import("../engine/types").CellResult }) {
  const bars = useMemo(
    () => computeTornado(addr, sheetIndex, allSheets),
    [addr, sheetIndex, allSheets, outputResult]
  );

  if (bars.length === 0) {
    return <div className="detail-body"><span className="detail-empty">No distribution inputs found</span></div>;
  }

  // Baseline is the output mean (all inputs at their means)
  const baseline = outputResult.kind === "samples"
    ? summarize(outputResult).mean
    : (outputResult as { kind: "scalar"; value: number }).value;

  // Scale range: include baseline and all bar endpoints
  const allValues = bars.flatMap((b) => [b.outputAtLow, b.outputAtHigh]);
  allValues.push(baseline);
  const globalMin = Math.min(...allValues);
  const globalMax = Math.max(...allValues);
  const span = globalMax - globalMin || 1;

  return (
    <div className="detail-body">
      <div className="analysis-scroll">
        <table className="tornado-table">
          <thead>
            <tr>
              <th className="tornado-label-col">Input (P5–P95)</th>
              <th className="tornado-bar-col">Output range</th>
              <th className="tornado-value-col">Swing</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b, i) => {
              const baselinePct = ((baseline - globalMin) / span) * 100;
              // "Input low" segment: from baseline to outputAtLow (red = input went down)
              const lowSegLeft = Math.min(b.outputAtLow, baseline);
              const lowSegRight = Math.max(b.outputAtLow, baseline);
              const lowLeftPct = ((lowSegLeft - globalMin) / span) * 100;
              const lowWidthPct = ((lowSegRight - lowSegLeft) / span) * 100;
              // "Input high" segment: from baseline to outputAtHigh (green = input went up)
              const highSegLeft = Math.min(b.outputAtHigh, baseline);
              const highSegRight = Math.max(b.outputAtHigh, baseline);
              const highLeftPct = ((highSegLeft - globalMin) / span) * 100;
              const highWidthPct = ((highSegRight - highSegLeft) / span) * 100;
              // Delta labels (relative to baseline)
              const deltaLow = b.outputAtLow - baseline;
              const deltaHigh = b.outputAtHigh - baseline;
              // Which delta goes on which side?
              const leftDelta = Math.min(deltaLow, deltaHigh);
              const rightDelta = Math.max(deltaLow, deltaHigh);
              const barLeftPct = Math.min(lowLeftPct, highLeftPct);
              const barRightPct = Math.max(lowLeftPct + lowWidthPct, highLeftPct + highWidthPct);
              const barTotalWidthPct = barRightPct - barLeftPct;
              return (
                <tr key={i}>
                  <td className="tornado-label" title={b.detail}>
                    {b.label}
                  </td>
                  <td className="tornado-bar-cell">
                    <div className="tornado-bar-track">
                      {lowWidthPct > 0.1 && (
                        <div
                          className="tornado-bar tornado-bar-low"
                          style={{ left: `${lowLeftPct}%`, width: `${lowWidthPct}%` }}
                        />
                      )}
                      {highWidthPct > 0.1 && (
                        <div
                          className="tornado-bar tornado-bar-high"
                          style={{ left: `${highLeftPct}%`, width: `${highWidthPct}%` }}
                        />
                      )}
                      <div className="tornado-baseline" style={{ left: `${baselinePct}%` }} />
                      {barTotalWidthPct > 8 && (
                        <>
                          <span
                            className="tornado-bar-label tornado-bar-label-left"
                            style={{ left: `${barLeftPct}%`, width: `${barTotalWidthPct / 2}%` }}
                          >
                            {formatNumber(leftDelta)}
                          </span>
                          <span
                            className="tornado-bar-label tornado-bar-label-right"
                            style={{ left: `${barLeftPct + barTotalWidthPct / 2}%`, width: `${barTotalWidthPct / 2}%` }}
                          >
                            +{formatNumber(rightDelta)}
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="tornado-value">
                    {formatNumber(Math.abs(b.outputAtHigh - b.outputAtLow))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Histogram ───────────────────────────────────────────────────────

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
