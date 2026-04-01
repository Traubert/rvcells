import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { Cell, Sheet } from "../engine/types";
import { summarize, histogram, collectInputs, spearmanCorrelation, computeTornado, resolveReference, getChainStepResult, computeChainTimeline } from "../engine/evaluate";
import { formatNumber } from "../format";
import { DEFAULT_NUM_HISTOGRAM_BINS } from "../constants";

export interface LockedRange {
  min: number;
  max: number;
}

/** Returns onMouseDown / onMouseUp / onMouseLeave handlers for a button that
 *  fires once on click, then auto-repeats with accelerating speed while held.
 *  Rapid discrete clicks (< 1s apart) also accelerate: the nth click applies
 *  a step of n². */
function useRepeatAction(action: (step: number) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(250);
  // rapid-click tracking
  const clickCountRef = useRef(0);
  const lastClickRef = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    action(1);
    delayRef.current = Math.max(30, delayRef.current * 0.82);
    timerRef.current = setTimeout(tick, delayRef.current);
  }, [action]);

  const start = useCallback(() => {
    // rapid-click acceleration
    const now = Date.now();
    if (now - lastClickRef.current < 1000) {
      clickCountRef.current++;
    } else {
      clickCountRef.current = 1;
    }
    lastClickRef.current = now;
    const n = clickCountRef.current;
    action(n * n);
    // begin hold-repeat
    delayRef.current = 250;
    timerRef.current = setTimeout(tick, delayRef.current);
  }, [action, tick]);

  useEffect(() => stop, [stop]);

  return { onMouseDown: start, onMouseUp: stop, onMouseLeave: stop };
}

type DetailTab = "distribution" | "correlation" | "variance" | "tornado" | "timeline";

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
  const baseResult = cell.result;
  if (!baseResult) return null;

  const isChain = cell.chainBody !== undefined;
  const [chainStep, setChainStep] = useState(0);

  // For chain cells, use the step's result; for others, use the cell's result
  const chainEval = useMemo(() => {
    if (!isChain || chainStep === 0) return { result: baseResult, error: null };
    try {
      return { result: getChainStepResult(cell, addr, chainStep, allSheets, sheetIndex), error: null };
    } catch (e) {
      return { result: baseResult, error: (e as Error).message };
    }
  }, [isChain, chainStep, baseResult, cell, addr, allSheets, sheetIndex]);
  const result = chainEval.result;
  const chainError = chainEval.error;

  const [activeTab, setActiveTab] = useState<DetailTab>("distribution");
  const [compareInput, setCompareInput] = useState<string | null>(null); // null = input hidden
  const [compareRef, setCompareRef] = useState<string>(""); // committed reference
  const [compareError, setCompareError] = useState(false);

  const isFormula = cell.content.kind === "formula";
  const distInputCount = useMemo(
    () => isFormula ? collectInputs(addr, sheetIndex, allSheets).filter(inp => !inp.isScalar).length : 0,
    [isFormula, addr, sheetIndex, allSheets, result]
  );
  const hasSensitivityTabs = distInputCount >= 2;

  // Clear comparison when selected cell changes; reset tab if timeline on non-chain
  useEffect(() => { setCompareRef(""); setCompareInput(null); }, [addr]);
  useEffect(() => {
    if (!isChain && activeTab === "timeline") setActiveTab("distribution");
    if (!hasSensitivityTabs && (activeTab === "correlation" || activeTab === "variance" || activeTab === "tornado")) setActiveTab("distribution");
  }, [isChain, hasSensitivityTabs, activeTab]);
  const compareInputRef = useRef<HTMLInputElement>(null);
  const [binCount, setBinCount] = useState(DEFAULT_NUM_HISTOGRAM_BINS);

  const stats = useMemo(() => summarize(result), [result]);
  const autoHist = useMemo(() => histogram(result, binCount), [result, binCount]);
  const hist = useMemo(
    () =>
      lockedRange
        ? histogram(result, binCount, lockedRange.min, lockedRange.max)
        : autoHist,
    [result, lockedRange, autoHist, binCount]
  );

  // Compare distribution
  const compareResolved = useMemo(() => {
    if (!compareRef) return null;
    return resolveReference(compareRef, sheetIndex, allSheets);
  }, [compareRef, sheetIndex, allSheets, result]); // result dep ensures refresh on recalc

  const compareResult = compareResolved?.cell.result;
  const compareStats = useMemo(
    () => compareResult ? summarize(compareResult) : null,
    [compareResult]
  );
  const compareHist = useMemo(
    () => {
      if (!compareResult) return null;
      if (lockedRange) return histogram(compareResult, binCount, lockedRange.min, lockedRange.max);
      return histogram(compareResult, binCount, autoHist.min, autoHist.max);
    },
    [compareResult, lockedRange, autoHist, binCount]
  );

  // Floor prevents sparse bins from spiking to full height when panning into tails,
  // but never exceeds total sample count so the tallest bin always fills the chart
  // when it contains all the data (e.g. scalar results, constant Chain steps).
  const nSamples = result.kind === "samples" ? result.values.length : 1;
  const maxBin = Math.max(Math.min(20, nSamples), ...hist.bins, ...(compareHist?.bins ?? []));
  const [guideMode, setGuideMode] = useState<GuideMode>("none");
  const [rangeUnit, setRangeUnit] = useState<"value" | "sigma" | "percentile">("value");

  const fewerBins = useCallback((step: number) => setBinCount(c => Math.max(5, c - step)), []);
  const moreBins = useCallback((step: number) => setBinCount(c => Math.min(250, c + step)), []);
  const fewerBinsRepeat = useRepeatAction(fewerBins);
  const moreBinsRepeat = useRepeatAction(moreBins);

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
      if (!result || result.kind !== "samples") return 50;
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
      if (!result || result.kind !== "samples") return stats.mean;
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

  // Scroll wheel zoom on histogram X range
  const histChartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = histChartRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const xFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const curMin = isLocked ? lockedRange!.min : autoHist.min;
      const curMax = isLocked ? lockedRange!.max : autoHist.max;
      const curRange = curMax - curMin;
      const factor = e.deltaY < 0 ? 0.9 : 1 / 0.9;
      const anchor = curMin + xFrac * curRange;
      const oldCentre = (curMin + curMax) / 2;
      const newCentre = oldCentre + 0.25 * (anchor - oldCentre);
      const newHalf = (curRange * factor) / 2;
      onLockRange({
        min: roundForDisplay(newCentre - newHalf),
        max: roundForDisplay(newCentre + newHalf),
      });
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  });

  // Drag-to-pan on histogram X range
  const panDragRef = useRef<{ startX: number; startMin: number; startMax: number } | null>(null);
  useEffect(() => {
    const el = histChartRef.current;
    if (!el) return;
    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const curMin = isLocked ? lockedRange!.min : autoHist.min;
      const curMax = isLocked ? lockedRange!.max : autoHist.max;
      panDragRef.current = { startX: e.clientX, startMin: curMin, startMax: curMax };
      el!.style.cursor = "grabbing";
      e.preventDefault();
    }
    function handleMouseMove(e: MouseEvent) {
      if (!panDragRef.current) return;
      const rect = el!.getBoundingClientRect();
      const pxDelta = e.clientX - panDragRef.current.startX;
      const rangeDelta = -(pxDelta / rect.width) * (panDragRef.current.startMax - panDragRef.current.startMin);
      onLockRange({
        min: roundForDisplay(panDragRef.current.startMin + rangeDelta),
        max: roundForDisplay(panDragRef.current.startMax + rangeDelta),
      });
    }
    function handleMouseUp() {
      if (!panDragRef.current) return;
      panDragRef.current = null;
      el!.style.cursor = "";
    }
    el.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      el.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const startHeight = panel.getBoundingClientRect().height;
    dragRef.current = { startY: e.clientY, startHeight };
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      setPanelHeight(Math.max(80, dragRef.current.startHeight + delta));
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div ref={panelRef} className={`detail-panel${panelHeight ? " detail-panel-resized" : ""}`} style={{ height: panelHeight ?? undefined }}>
      <div className="detail-resize-handle" onMouseDown={handleDragStart} />
      <div className="detail-header">
        <span className="detail-addr">{addr}</span>
        {cell.variableName && (
          <span className="detail-var">{cell.variableName}</span>
        )}
        <span className="detail-raw">{cell.raw}</span>
        {isChain && activeTab !== "timeline" && (
          <div className="chain-step-controls">
            <button className="detail-tab" onClick={() => setChainStep(s => Math.max(0, s - 1))} disabled={chainStep === 0}>◀</button>
            <span className="chain-step-label">Step {chainStep}</span>
            <button className="detail-tab" onClick={() => setChainStep(s => s + 1)}>▶</button>
            {chainError && <span className="compare-error">{chainError}</span>}
          </div>
        )}
        {(activeTab === "distribution" || activeTab === "timeline") && <div className="compare-controls">
          {compareInput !== null ? (
            <span className="compare-input-wrap">
              <input
                ref={compareInputRef}
                className="compare-input"
                value={compareInput}
                placeholder="Cell or variable..."
                onChange={(e) => setCompareInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = compareInput.trim();
                    const resolved = val ? resolveReference(val, sheetIndex, allSheets) : null;
                    if (resolved) {
                      const wantChain = activeTab === "timeline";
                      const isCompareChain = resolved.cell.chainBody !== undefined;
                      if (wantChain && !isCompareChain) {
                        setCompareError(true);
                        setTimeout(() => setCompareError(false), 2000);
                      } else {
                        setCompareRef(val);
                      }
                    } else if (val) {
                      setCompareError(true);
                      setTimeout(() => setCompareError(false), 2000);
                    }
                    setCompareInput(null);
                    onReturnFocus();
                  }
                  if (e.key === "Escape") {
                    setCompareInput(null);
                    onReturnFocus();
                  }
                  e.stopPropagation();
                }}
                onBlur={() => setCompareInput(null)}
                autoFocus
              />
            </span>
          ) : compareRef ? (
            <button
              className="detail-tab compare-active"
              onClick={() => { setCompareRef(""); }}
              title="Click to remove comparison"
            >
              Comparing with <span className="compare-ref-name">{compareRef}</span> ×
            </button>
          ) : (
            <>
              <button
                className="detail-tab"
                onClick={() => { setCompareInput(""); }}
              >
                Compare...
              </button>
              {compareError && <span className="compare-error">{activeTab === "timeline" ? "Must be a Chain cell" : "Couldn't resolve reference"}</span>}
            </>
          )}
        </div>}
        {(hasSensitivityTabs || isChain) && (
          <div className="detail-tabs">
            <button
              className={`detail-tab ${activeTab === "distribution" ? "detail-tab-active" : ""}`}
              onClick={() => setActiveTab("distribution")}
            >
              Histogram
            </button>
            {hasSensitivityTabs && <>
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
            </>}
            {isChain && (
              <button
                className={`detail-tab ${activeTab === "timeline" ? "detail-tab-active" : ""}`}
                onClick={() => setActiveTab("timeline")}
              >
                Timeline
              </button>
            )}
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

          {compareStats && (
            <table className="detail-stats compare-stats">
              <tbody>
                <tr><td>Mean</td><td>{formatNumber(compareStats.mean)}</td></tr>
                <tr><td>Std Dev</td><td>{formatNumber(compareStats.std)}</td></tr>
                <tr><td>P5</td><td>{formatNumber(compareStats.p5)}</td></tr>
                <tr><td>P25</td><td>{formatNumber(compareStats.p25)}</td></tr>
                <tr><td>P50</td><td>{formatNumber(compareStats.p50)}</td></tr>
                <tr><td>P75</td><td>{formatNumber(compareStats.p75)}</td></tr>
                <tr><td>P95</td><td>{formatNumber(compareStats.p95)}</td></tr>
              </tbody>
            </table>
          )}

          <div ref={histChartRef} className="detail-chart">
            <Histogram hist={hist} maxBin={maxBin} stats={stats} guideMode={guideMode} compareHist={compareHist} result={result} />
          </div>

          <div className="detail-controls">
            <button className="hist-guide-toggle" onClick={cycleGuideMode}>{guideModeLabel}</button>
            <div className="bin-count-controls">
              <button
                className="range-button"
                {...fewerBinsRepeat}
                title="Fewer bins"
              >−</button>
              <span className="bin-count-label">Bins: {binCount}</span>
              <button
                className="range-button"
                {...moreBinsRepeat}
                title="More bins"
              >+</button>
            </div>
            <div className="detail-range-controls">
              <div className="lock-range-row">
                <label className="lock-range-label">
                  <input
                    type="checkbox"
                    checked={isLocked}
                    onChange={() => { handleLockToggle(); onReturnFocus(); }}
                  />
                  Set range
                </label>
                {isLocked && (() => {
                  const autoRange = autoHist.max - autoHist.min;
                  const changed = autoRange > 0 && (
                    Math.abs(lockedRange.min - autoHist.min) / autoRange > 0.001 ||
                    Math.abs(lockedRange.max - autoHist.max) / autoRange > 0.001
                  );
                  return changed ? (
                    <button
                      className="range-button"
                      onClick={() => {
                        onLockRange({
                          min: roundForDisplay(autoHist.min),
                          max: roundForDisplay(autoHist.max),
                        });
                        onReturnFocus();
                      }}
                      title="Reset to default range"
                    >
                      Reset
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
                  if (isNaN(num) || !lockedRange) return;
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

      {activeTab === "timeline" && isChain && (
        <TimelineView
          cell={cell} addr={addr} allSheets={allSheets} sheetIndex={sheetIndex}
          compareCell={compareResolved?.cell.chainBody ? compareResolved.cell : undefined}
          compareAddr={compareResolved?.addr}
          compareSheetIndex={compareResolved?.sheetIndex}
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

function Histogram({ hist, maxBin, stats, guideMode, compareHist, result }: {
  hist: { min: number; max: number; bins: number[]; binWidth: number };
  maxBin: number;
  stats: { mean: number; std: number; p5: number; p25: number; p50: number; p75: number; p95: number };
  guideMode: GuideMode;
  compareHist?: { min: number; max: number; bins: number[]; binWidth: number } | null;
  result: import("../engine/types").CellResult;
}) {
  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const [hoverXPct, setHoverXPct] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const totalSamples = useMemo(() => hist.bins.reduce((a, b) => a + b, 0), [hist.bins]);

  // Pre-sort samples for fast cumulative lookup
  const sortedSamples = useMemo(() => {
    if (result.kind !== "samples") return null;
    return new Float64Array(result.values).sort();
  }, [result]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xFrac = (e.clientX - rect.left) / rect.width;
    const bin = Math.floor(xFrac * hist.bins.length);
    if (bin >= 0 && bin < hist.bins.length) {
      setHoverBin(bin);
    } else {
      setHoverBin(null);
    }
    setHoverXPct(Math.max(0, Math.min(100, xFrac * 100)));
  }, [hist.bins.length]);

  const handleMouseLeave = useCallback(() => { setHoverBin(null); setHoverXPct(null); }, []);

  const compareTotalSamples = useMemo(
    () => compareHist ? compareHist.bins.reduce((a, b) => a + b, 0) : 0,
    [compareHist]
  );

  const hoverInfo = hoverBin !== null ? {
    lo: hist.min + hoverBin * hist.binWidth,
    hi: hist.min + (hoverBin + 1) * hist.binWidth,
    pct: totalSamples > 0 ? (hist.bins[hoverBin] / totalSamples) * 100 : 0,
    comparePct: compareHist && compareTotalSamples > 0
      ? (compareHist.bins[hoverBin] / compareTotalSamples) * 100
      : null,
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
              key={`m${i}`}
              x={i}
              y={maxBin > 0 ? 100 - (count / maxBin) * 100 : 100}
              width={0.9}
              height={maxBin > 0 ? (count / maxBin) * 100 : 0}
              className={`hist-bar ${i === hoverBin ? "hist-bar-hover" : ""}`}
            />
          ))}
          {compareHist?.bins.map((count, i) => (
            <rect
              key={`c${i}`}
              x={i}
              y={maxBin > 0 ? 100 - (count / maxBin) * 100 : 100}
              width={0.9}
              height={maxBin > 0 ? (count / maxBin) * 100 : 0}
              className="hist-bar-compare"
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
        {guideMode !== "none" && hoverXPct !== null && sortedSamples && range > 0 && (() => {
          const hoverValue = hist.min + (hoverXPct / 100) * range;
          let leftLabel: string, rightLabel: string;
          if (guideMode === "sigma") {
            const sigma = stats.std > 0 ? (hoverValue - stats.mean) / stats.std : 0;
            leftLabel = "";
            rightLabel = (sigma >= 0 ? "+" : "") + sigma.toFixed(2) + "σ";
          } else {
            // Binary search for cumulative %
            let lo = 0, hi = sortedSamples.length;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (sortedSamples[mid] <= hoverValue) lo = mid + 1; else hi = mid;
            }
            const leftPct = (lo / sortedSamples.length) * 100;
            const rightPct = 100 - leftPct;
            leftLabel = leftPct.toFixed(1) + "%";
            rightLabel = rightPct.toFixed(1) + "%";
          }
          return (
            <div className="hist-guideline hist-cursor-guide" style={{ left: `${hoverXPct}%` }}>
              <span className="hist-cursor-left">{leftLabel}</span>
              <span className="hist-cursor-right">{rightLabel}</span>
            </div>
          );
        })()}
      </div>
      <div className="hist-axis">
        {range > 0 && (() => {
          const ticks = niceGridLines(hist.min, hist.max, 6);
          return <>
            <span className="hist-tick" style={{ left: 0 }}>{formatNumber(hist.min)}</span>
            {ticks.filter(v => v > hist.min && v < hist.max).map(v => (
              <span key={v} className="hist-tick" style={{ left: `${((v - hist.min) / range) * 100}%` }}>
                {formatNumber(v)}
              </span>
            ))}
            <span className="hist-tick" style={{ right: 0 }}>{formatNumber(hist.max)}</span>
          </>;
        })()}
        {hoverInfo && (
          <span className="hist-hover-info">
            {formatNumber(hoverInfo.lo)}–{formatNumber(hoverInfo.hi)}: {hoverInfo.pct.toFixed(1)}%
            {hoverInfo.comparePct !== null && (
              <span className="hist-hover-compare"> / {hoverInfo.comparePct.toFixed(1)}%</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Timeline view (fan chart for Chain cells) ──────────────────────

interface TimelineViewProps {
  cell: Cell;
  addr: string;
  allSheets: Sheet[];
  sheetIndex: number;
  compareCell?: Cell;
  compareAddr?: string;
  compareSheetIndex?: number;
}

function TimelineView({ cell, addr, allSheets, sheetIndex, compareCell, compareAddr, compareSheetIndex }: TimelineViewProps) {
  const [numSteps, setNumSteps] = useState(50);
  const [stepsInput, setStepsInput] = useState("50");
  const [hoverPos, setHoverPos] = useState<{ xFrac: number; yFrac: number } | null>(null);
  const [lockedXRange, setLockedXRange] = useState<{ min: number; max: number } | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const timelineResult = useMemo(() => {
    try {
      return { data: computeChainTimeline(cell, addr, numSteps, allSheets, sheetIndex), error: null };
    } catch (e) {
      return { data: [], error: (e as Error).message };
    }
  }, [cell, addr, numSteps, allSheets, sheetIndex]);
  const timeline = timelineResult.data;

  const compareTimeline = useMemo(() => {
    if (!compareCell || !compareAddr || compareSheetIndex === undefined) return [];
    try {
      return computeChainTimeline(compareCell, compareAddr, numSteps, allSheets, compareSheetIndex);
    } catch {
      return [];
    }
  }, [compareCell, compareAddr, compareSheetIndex, numSteps, allSheets]);

  const isXLocked = lockedXRange !== null;
  const xViewMin = isXLocked ? lockedXRange.min : 0;
  const xViewMax = isXLocked ? lockedXRange.max : numSteps;

  function applyXZoom(factor: number, anchorFrac?: number) {
    const curMin = isXLocked ? lockedXRange!.min : 0;
    const curMax = isXLocked ? lockedXRange!.max : numSteps;
    const curRange = curMax - curMin;
    const anchor = anchorFrac !== undefined
      ? curMin + anchorFrac * curRange
      : (curMin + curMax) / 2;
    const newRange = curRange * factor;
    if (newRange < 2) return; // don't zoom below 2 steps
    const oldCentre = (curMin + curMax) / 2;
    const newCentre = oldCentre + 0.25 * (anchor - oldCentre);
    let newMin = newCentre - newRange / 2;
    let newMax = newCentre + newRange / 2;
    // Clamp to bounds while preserving range width
    if (newMin < 0) { newMax -= newMin; newMin = 0; }
    if (newMax > numSteps) { newMin -= (newMax - numSteps); newMax = numSteps; }
    newMin = Math.max(0, newMin);
    setLockedXRange({ min: newMin, max: newMax });
  }

  // Mouse wheel zoom on X axis
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const xFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (e.deltaY < 0) {
        applyXZoom(0.9, xFrac);
      } else if (e.deltaY > 0) {
        applyXZoom(1 / 0.9, xFrac);
      }
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  });

  if (timelineResult.error) {
    return <div className="detail-body"><span className="compare-error">{timelineResult.error}</span></div>;
  }
  if (timeline.length === 0) return null;

  // Filter visible steps and compute Y range to fit
  const visibleSteps = timeline.filter(s => s.step >= Math.floor(xViewMin) && s.step <= Math.ceil(xViewMax));
  const visibleCmpSteps = compareTimeline.filter(s => s.step >= Math.floor(xViewMin) && s.step <= Math.ceil(xViewMax));
  let yMin = Infinity, yMax = -Infinity;
  for (const s of (visibleSteps.length > 0 ? visibleSteps : timeline)) {
    if (s.p5 < yMin) yMin = s.p5;
    if (s.p95 > yMax) yMax = s.p95;
  }
  for (const s of visibleCmpSteps) {
    if (s.p5 < yMin) yMin = s.p5;
    if (s.p95 > yMax) yMax = s.p95;
  }
  const yPad = (yMax - yMin) * 0.05 || 1;
  yMin -= yPad;
  yMax += yPad;
  const yRange = yMax - yMin;
  const xRange = xViewMax - xViewMin;

  function toXPct(step: number): number { return xRange > 0 ? ((step - xViewMin) / xRange) * 100 : 50; }
  function toYPct(val: number): number { return yRange > 0 ? ((yMax - val) / yRange) * 100 : 50; }
  function fromYPct(pct: number): number { return yMax - (pct / 100) * yRange; }

  type TimelineStep = typeof timeline[0];
  function svgLine(data: TimelineStep[], getter: (s: TimelineStep) => number): string {
    return data.map(s => `${toXPct(s.step)},${toYPct(getter(s))}`).join(" ");
  }
  function svgBand(data: TimelineStep[], upper: (s: TimelineStep) => number, lower: (s: TimelineStep) => number): string {
    return svgLine(data, upper) + " " + [...data].reverse().map(s => `${toXPct(s.step)},${toYPct(lower(s))}`).join(" ");
  }

  const medianLine = svgLine(timeline, s => s.p50);
  const outerBand = svgBand(timeline, s => s.p95, s => s.p5);
  const innerBand = svgBand(timeline, s => s.p75, s => s.p25);

  const cmpMedianLine = compareTimeline.length > 0 ? svgLine(compareTimeline, s => s.p50) : null;
  const cmpOuterBand = compareTimeline.length > 0 ? svgBand(compareTimeline, s => s.p95, s => s.p5) : null;
  const cmpInnerBand = compareTimeline.length > 0 ? svgBand(compareTimeline, s => s.p75, s => s.p25) : null;

  // Hover: compute step and y value from visible range
  const hoverStep = hoverPos !== null ? Math.round(xViewMin + hoverPos.xFrac * xRange) : null;
  const hoverY = hoverPos !== null ? fromYPct(hoverPos.yFrac * 100) : null;
  const hoveredStats = hoverStep !== null && hoverStep >= 0 && hoverStep < timeline.length ? timeline[hoverStep] : null;
  const cmpHoveredStats = hoverStep !== null && hoverStep >= 0 && hoverStep < compareTimeline.length ? compareTimeline[hoverStep] : null;

  // Y-axis gridlines: pick ~4 nice round values
  const yGridLines = niceGridLines(yMin, yMax, 4);
  const xGridLines = niceGridLines(xViewMin, xViewMax, 6).filter(v => v > xViewMin && v < xViewMax);

  function commitSteps() {
    const n = parseInt(stepsInput, 10);
    if (!isNaN(n) && n > 0) {
      setNumSteps(n);
      setStepsInput(String(n));
    } else {
      setStepsInput(String(numSteps));
    }
  }

  function handleLockToggle() {
    if (isXLocked) {
      setLockedXRange(null);
    } else {
      setLockedXRange({ min: 0, max: numSteps });
    }
  }

  const showRecentre = isXLocked && (
    Math.abs(xViewMin) > 0.01 || Math.abs(xViewMax - numSteps) > 0.01
  );

  return (
    <div className="detail-body timeline-body">
      <div className="timeline-controls">
        <label>
          Steps: <input
            type="number"
            className="timeline-steps-input"
            value={stepsInput}
            onChange={e => {
              setStepsInput(e.target.value);
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n > 0) setNumSteps(n);
            }}
            onBlur={commitSteps}
            onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitSteps(); }}
            min={1}
            max={10000}
          />
        </label>
        <span className="timeline-legend">
          <span className="timeline-legend-outer">P5–P95</span>
          <span className="timeline-legend-inner">P25–P75</span>
          <span className="timeline-legend-median">Median</span>
        </span>
        {hoveredStats && (
          <span className="timeline-hover-stats">
            Step {hoveredStats.step}: median {formatNumber(hoveredStats.p50)}, P5–P95: {formatNumber(hoveredStats.p5)}–{formatNumber(hoveredStats.p95)}
          </span>
        )}
      </div>
      <div className="timeline-main-row">
        <div className="timeline-chart-col">
          <div className="timeline-chart-area">
            <div className="timeline-yaxis">
              {yGridLines.map(v => (
                <span key={v} className="timeline-ylabel" style={{ bottom: `${((v - yMin) / yRange) * 100}%` }}>
                  {formatNumber(v)}
                </span>
              ))}
            </div>
            <div
              ref={chartRef}
              className="timeline-chart"
              onMouseMove={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoverPos({
                  xFrac: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
                  yFrac: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
                });
              }}
              onMouseLeave={() => setHoverPos(null)}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="timeline-svg">
                {/* Gridlines */}
                {yGridLines.map(v => (
                  <line key={`y${v}`} x1="0" x2="100" y1={toYPct(v)} y2={toYPct(v)} className="timeline-gridline" />
                ))}
                {xGridLines.map(v => (
                  <line key={`x${v}`} x1={toXPct(v)} x2={toXPct(v)} y1="0" y2="100" className="timeline-gridline" />
                ))}
                <polygon points={outerBand} className="timeline-band-outer" />
                <polygon points={innerBand} className="timeline-band-inner" />
                <polyline points={medianLine} className="timeline-median" />
                {cmpOuterBand && <polygon points={cmpOuterBand} className="timeline-cmp-band-outer" />}
                {cmpInnerBand && <polygon points={cmpInnerBand} className="timeline-cmp-band-inner" />}
                {cmpMedianLine && <polyline points={cmpMedianLine} className="timeline-cmp-median" />}
              </svg>
              {hoverPos !== null && (
                <>
                  <div className="timeline-cursor" style={{ left: `${hoverPos.xFrac * 100}%` }} />
                  <div className="timeline-cursor-h" style={{ top: `${hoverPos.yFrac * 100}%` }} />
                  <span
                    className="timeline-hover-label timeline-hover-y-above"
                    style={{ top: `${hoverPos.yFrac * 100}%` }}
                  >
                    {hoveredStats && hoverY !== null && (
                      <span className="timeline-pct-at-cursor">{interpolatePct(hoverY, hoveredStats)}</span>
                    )}
                    <br />
                    {hoverY !== null ? formatNumber(hoverY) : ""}
                  </span>
                  {cmpHoveredStats && hoverY !== null && (
                    <span
                      className="timeline-hover-label timeline-hover-y-below"
                      style={{ top: `${hoverPos.yFrac * 100}%` }}
                    >
                      {interpolatePct(hoverY, cmpHoveredStats)}
                    </span>
                  )}
                  <span
                    className="timeline-hover-label timeline-hover-t"
                    style={{ left: `${hoverPos.xFrac * 100}%` }}
                  >
                    t={hoverStep ?? ""}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="timeline-axis">
            <span style={{ position: "absolute", left: 0 }}>{Math.round(xViewMin)}</span>
            {xGridLines.map(v => (
              <span key={v} style={{ position: "absolute", left: `${toXPct(v)}%`, transform: "translateX(-50%)" }}>{Math.round(v)}</span>
            ))}
            <span style={{ position: "absolute", right: 0 }}>{Math.round(xViewMax)}</span>
          </div>
        </div>
        <div className="timeline-range-controls">
          <div className="lock-range-row">
            <label className="lock-range-label">
              <input
                type="checkbox"
                checked={isXLocked}
                onChange={handleLockToggle}
              />
              Set range
            </label>
            {showRecentre && (
              <button
                className="range-button"
                onClick={() => setLockedXRange({ min: 0, max: numSteps })}
                title="Reset to full range"
              >
                Reset
              </button>
            )}
          </div>
          {isXLocked && (
            <span className="zoom-buttons">
              <button className="zoom-button" onClick={() => applyXZoom(0.9)} title="Zoom in">+</button>
              <button className="zoom-button" onClick={() => applyXZoom(1 / 0.9)} title="Zoom out">−</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Interpolate a percentile string from known breakpoints (p5, p25, p50, p75, p95) */
function interpolatePct(
  y: number,
  stats: { p5: number; p25: number; p50: number; p75: number; p95: number },
): string {
  const pts: [number, number][] = [
    [stats.p5, 5], [stats.p25, 25], [stats.p50, 50], [stats.p75, 75], [stats.p95, 95],
  ];
  if (y <= pts[0][0]) return "≤P5";
  if (y >= pts[4][0]) return "≥P95";
  for (let i = 0; i < pts.length - 1; i++) {
    const [v0, p0] = pts[i];
    const [v1, p1] = pts[i + 1];
    if (y <= v1) {
      const frac = v1 !== v0 ? (y - v0) / (v1 - v0) : 0;
      return `P${Math.round(p0 + frac * (p1 - p0))}`;
    }
  }
  return "≥P95";
}

/** Pick ~count nice round gridline values between min and max */
function niceGridLines(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (range <= 0) return [];
  const rough = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step: number;
  if (rough / mag >= 5) step = 5 * mag;
  else if (rough / mag >= 2) step = 2 * mag;
  else step = mag;
  const lines: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max; v += step) {
    lines.push(v);
  }
  return lines;
}
