import { useState, useEffect } from "react";

const PAGES = [
  {
    title: "Basics",
    content: (
      <>
        <section>
          <h3>Keyboard</h3>
          <table className="help-table">
            <tbody>
              <tr><td>Enter / F2</td><td>Edit cell</td></tr>
              <tr><td>=</td><td>Start new formula</td></tr>
              <tr><td>Delete / Backspace</td><td>Clear cell</td></tr>
              <tr><td>Escape</td><td>Cancel edit / deselect</td></tr>
              <tr><td>Arrow keys</td><td>Navigate</td></tr>
              <tr><td>Tab</td><td>Commit &amp; move right</td></tr>
              <tr><td>R</td><td>Recalculate cell &amp; dependents</td></tr>
              <tr><td>Shift+R</td><td>Recalculate entire sheet</td></tr>
              <tr><td>H</td><td>This help screen</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Cell syntax</h3>
          <table className="help-table">
            <tbody>
              <tr><td><code>42</code></td><td>Scalar number</td></tr>
              <tr><td><code>Normal(100, 10)</code></td><td>Distribution (sampled)</td></tr>
              <tr><td><code>= A1 + B1</code></td><td>Formula</td></tr>
              <tr><td><code>income = 5000</code></td><td>Named variable</td></tr>
              <tr><td><code>:= A1 * 12</code></td><td>Variable named by left cell</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Distributions</h3>
          <table className="help-table">
            <tbody>
              <tr><td><code>Normal(mean, std)</code></td><td>Gaussian</td></tr>
              <tr><td><code>LogNormal(mu, sigma)</code></td><td>Log-normal</td></tr>
              <tr><td><code>Uniform(low, high)</code></td><td>Uniform</td></tr>
              <tr><td><code>Triangular(low, mode, high)</code></td><td>Triangular</td></tr>
              <tr><td><code>Beta(alpha, beta)</code></td><td>Beta on [0, 1]</td></tr>
            </tbody>
          </table>
          <p className="help-note">Distributions can also be used in formulas: <code>= Normal(100, 10) * 12</code></p>
        </section>
      </>
    ),
  },
  {
    title: "Functions",
    content: (
      <>
        <section>
          <h3>Math functions</h3>
          <p className="help-note">All functions work elementwise on distributions.</p>
          <table className="help-table">
            <tbody>
              <tr><td><code>abs(x)</code></td><td>Absolute value</td></tr>
              <tr><td><code>sqrt(x)</code></td><td>Square root</td></tr>
              <tr><td><code>exp(x)</code></td><td>e<sup>x</sup></td></tr>
              <tr><td><code>log(x)</code> / <code>ln(x)</code></td><td>Natural logarithm</td></tr>
              <tr><td><code>log10(x)</code></td><td>Base-10 logarithm</td></tr>
              <tr><td><code>floor(x)</code></td><td>Round down</td></tr>
              <tr><td><code>ceil(x)</code></td><td>Round up</td></tr>
              <tr><td><code>round(x)</code></td><td>Round to nearest</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Two-argument functions</h3>
          <table className="help-table">
            <tbody>
              <tr><td><code>pow(x, y)</code></td><td>x raised to power y</td></tr>
              <tr><td><code>min(x, y)</code></td><td>Smaller of x, y</td></tr>
              <tr><td><code>max(x, y)</code></td><td>Larger of x, y</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Other functions</h3>
          <table className="help-table">
            <tbody>
              <tr><td><code>clamp(x, lo, hi)</code></td><td>Constrain x to [lo, hi]</td></tr>
              <tr><td><code>if(cond, then, else)</code></td><td>cond &gt; 0 picks <em>then</em>, otherwise <em>else</em></td></tr>
            </tbody>
          </table>
        </section>
      </>
    ),
  },
];

interface HelpDialogProps {
  onClose: () => void;
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  const [page, setPage] = useState(0);

  function prev() { setPage((p) => Math.max(0, p - 1)); }
  function next() { setPage((p) => Math.min(PAGES.length - 1, p + 1)); }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog help-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <button
            className="help-nav-arrow"
            onClick={prev}
            disabled={page === 0}
          >
            &#9664;
          </button>
          <span className="help-page-indicator">
            Help {page + 1}/{PAGES.length} — {PAGES[page].title}
          </span>
          <button
            className="help-nav-arrow"
            onClick={next}
            disabled={page === PAGES.length - 1}
          >
            &#9654;
          </button>
        </div>
        <div className="help-body">
          {PAGES[page].content}
        </div>
      </div>
    </div>
  );
}
