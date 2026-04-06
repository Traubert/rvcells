import { useState, useEffect } from "react";
import { examples } from "../examples";
import type { FileFormat } from "../engine/file";

const PAGES = [
  {
    title: "Basics",
    content: (
      <>
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
              <tr><td><code>Pareto(xMin, alpha)</code></td><td>Heavy-tailed power law</td></tr>
              <tr><td><code>Poisson(lambda)</code></td><td>Count of events per interval</td></tr>
              <tr><td><code>StudentT(nu)</code></td><td>Heavy-tailed symmetric</td></tr>
              <tr><td><code>StudentT(nu, mu, sigma)</code></td><td>Location-scale Student&apos;s t</td></tr>
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
        <section>
          <h3>Sampling functions</h3>
          <table className="help-table">
            <tbody>
              <tr><td><code>Bernoulli(p)</code></td><td>Samples 0 or 1 with probability p</td></tr>
              <tr><td><code>Discrete(p1, p2, ...)</code></td><td>Samples from &#123;0, 1, ...&#125; with given probabilities</td></tr>
              <tr><td><code>resample(cell)</code></td><td>Fresh independent draw from the same process</td></tr>
              <tr><td><code>Chain(body, init)</code></td><td>Iterative process; body uses own variable as previous step</td></tr>
              <tr><td><code>chain[n]</code></td><td>Distribution at step n of a Chain</td></tr>
              <tr><td><code>ChainIndex(chain, cond)</code></td><td>First step where condition is true (e.g. <code>mean(x) &gt; 100</code>)</td></tr>
            </tbody>
          </table>
          <p className="help-note"><code>Chain()</code> auto-resamples referenced distributions each step. Use <code>_t</code> inside the body for the current step number.</p>
        </section>
      </>
    ),
  },
  {
    title: "Keyboard",
    content: (
      <>
        <section>
          <h3>Editing</h3>
          <table className="help-table">
            <tbody>
              <tr><td>Type any character</td><td>Start editing cell</td></tr>
              <tr><td>Enter / F2</td><td>Edit existing content</td></tr>
              <tr><td>Delete / Backspace</td><td>Clear cell(s)</td></tr>
              <tr><td>Escape</td><td>Cancel edit / deselect</td></tr>
              <tr><td>Tab</td><td>Commit &amp; move right</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Navigation</h3>
          <table className="help-table">
            <tbody>
              <tr><td>Arrow keys</td><td>Move selection</td></tr>
              <tr><td>PgUp / PgDn</td><td>Jump up / down</td></tr>
              <tr><td>Shift + Arrow</td><td>Extend selection</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Clipboard &amp; undo</h3>
          <table className="help-table">
            <tbody>
              <tr><td>Ctrl+C / Ctrl+X</td><td>Copy / cut</td></tr>
              <tr><td>Ctrl+Shift+C / X</td><td>Copy / cut resolved values</td></tr>
              <tr><td>Ctrl+V</td><td>Paste</td></tr>
              <tr><td>Ctrl+Z</td><td>Undo</td></tr>
              <tr><td>Ctrl+Y / Ctrl+Shift+Z</td><td>Redo</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Global</h3>
          <table className="help-table">
            <tbody>
              <tr><td>Ctrl+R</td><td>Recalculate cell &amp; dependents</td></tr>
              <tr><td>Ctrl+Shift+R</td><td>Recalculate all sheets</td></tr>
              <tr><td>Ctrl+S</td><td>Save to browser storage</td></tr>
              <tr><td>Ctrl+O</td><td>Open from browser storage</td></tr>
              <tr><td>Ctrl+H</td><td>This help screen</td></tr>
            </tbody>
          </table>
        </section>
      </>
    ),
  },
];

const TOTAL_PAGES = PAGES.length + 1; // +1 for Examples page

interface HelpDialogProps {
  onClose: () => void;
  onLoadExample: (data: FileFormat) => void;
}

export function HelpDialog({ onClose, onLoadExample }: HelpDialogProps) {
  const [page, setPage] = useState(0);

  function prev() { setPage((p) => Math.max(0, p - 1)); }
  function next() { setPage((p) => Math.min(TOTAL_PAGES - 1, p + 1)); }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const pageTitle = page < PAGES.length ? PAGES[page].title : "Examples";

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
            Help {page + 1}/{TOTAL_PAGES} — {pageTitle}
          </span>
          <button
            className="help-nav-arrow"
            onClick={next}
            disabled={page === TOTAL_PAGES - 1}
          >
            &#9654;
          </button>
        </div>
        <div className="help-body">
          {page < PAGES.length ? PAGES[page].content : (
            <>
              <p className="help-note" style={{ marginBottom: 12 }}>
                Load an example workbook to explore how rvcells works. This will replace your current workbook.
              </p>
              {examples.map((ex) => (
                <div key={ex.name} className="example-row">
                  <div className="example-info">
                    <strong>{ex.name}</strong>
                    <span className="example-desc">{ex.description}</span>
                  </div>
                  <button
                    className="dialog-button example-load"
                    onClick={() => {
                      onLoadExample(ex.data);
                      onClose();
                    }}
                  >
                    Load
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
