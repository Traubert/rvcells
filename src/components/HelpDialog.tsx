import { useState, useEffect, useRef } from "react";
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
          <p className="help-note">Distributions can be entered directly or used in formulas: <code style={{ whiteSpace: "nowrap" }}>= Normal(100, 10) * 12</code></p>
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
          <p className="help-note">All work elementwise on distributions.</p>
          <table className="help-table">
            <tbody>
              <tr><td><code>abs(x)</code></td><td>Absolute value</td></tr>
              <tr><td><code>sqrt(x)</code></td><td>Square root</td></tr>
              <tr><td><code>exp(x)</code></td><td>e<sup>x</sup></td></tr>
              <tr><td><code>log(x)</code> / <code>ln(x)</code></td><td>Natural logarithm</td></tr>
              <tr><td><code>log10(x)</code></td><td>Base-10 logarithm</td></tr>
              <tr><td><code>floor(x)</code>, <code>ceil(x)</code>, <code>round(x)</code></td><td>Rounding</td></tr>
              <tr><td><code>pow(x, y)</code></td><td>x raised to power y</td></tr>
              <tr><td><code>clamp(x, lo, hi)</code></td><td>Constrain x to [lo, hi]</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h3>Logic &amp; sampling</h3>
          <table className="help-table">
            <tbody>
              <tr><td><code>if(cond, then, else)</code></td><td>Nonzero <em>cond</em> picks <em>then</em>, zero picks <em>else</em></td></tr>
              <tr><td><code>Bernoulli(p)</code></td><td>Samples 0 or 1 with probability p</td></tr>
              <tr><td><code>Discrete(p1, p2, ...)</code></td><td>Samples from &#123;0, 1, ...&#125; with given weights</td></tr>
            </tbody>
          </table>
          <p className="help-note"><code>if()</code> and comparison operators (<code>&gt;</code>, <code>&lt;</code>, <code>==</code>, ...) work elementwise: each sample is decided independently. So <code>if(Bernoulli(0.3), x, y)</code> picks <code>x</code> for ~30% of samples and <code>y</code> for the rest.</p>
        </section>
        <section>
          <h3>Aggregates</h3>
          <p className="help-note">Accept ranges (<code>A1:A10</code>) and chain steps (<code>x[0:12]</code>). With a single distribution argument, collapse to a scalar statistic.</p>
          <table className="help-table">
            <tbody>
              <tr><td><code>sum(...)</code></td><td>Sum of values</td></tr>
              <tr><td><code>product(...)</code></td><td>Product of values</td></tr>
              <tr><td><code>mean(x)</code></td><td>Arithmetic mean</td></tr>
              <tr><td><code>median(x)</code></td><td>Median (P50)</td></tr>
              <tr><td><code>geomean(x)</code></td><td>Geometric mean</td></tr>
              <tr><td><code>min(x, y)</code> / <code>max(x, y)</code></td><td>Elementwise min/max, or sample min/max when collapsing</td></tr>
              <tr><td><code>P(dist, pct)</code></td><td>Percentile of a distribution (0&ndash;100)</td></tr>
            </tbody>
          </table>
        </section>
      </>
    ),
  },
  {
    title: "Chains",
    content: (
      <>
        <section>
          <h3>Iterative processes</h3>
          <table className="help-table">
            <tbody>
              <tr><td><code>Chain(body, init)</code></td><td>Iterative process; body uses own variable as previous step</td></tr>
              <tr><td><code>chain[n]</code></td><td>Distribution at step n</td></tr>
              <tr><td><code>chain[a:b]</code></td><td>Range of steps (for use with sum, mean, etc.)</td></tr>
              <tr><td><code>resample(cell)</code></td><td>Fresh independent draw from the same process</td></tr>
              <tr><td><code>_t</code></td><td>Current step number inside a Chain body</td></tr>
            </tbody>
          </table>
          <p className="help-note"><code>Chain()</code> auto-resamples referenced distributions each step. Referenced chains auto-sync to the same step.</p>
          <p className="help-note"><code>ChainIndex(chain, cond)</code> searches for the first step where a condition holds. The condition is evaluated at each step with the chain mapped to that step&apos;s distribution, and must reduce it to a scalar using <code>mean()</code>, <code>P()</code>, <code>min()</code>, etc.:</p>
          <table className="help-table">
            <tbody>
              <tr><td colSpan={2}><code>ChainIndex(x, mean(x) &gt; 1000)</code></td></tr>
              <tr><td colSpan={2}><code>ChainIndex(x, P(x, 10) &gt; 500)</code></td></tr>
            </tbody>
          </table>
          <p className="help-note">Search limit is configurable in Settings (default 1,000).</p>
        </section>
        <section>
          <h3>Markov chains</h3>
          <p className="help-note"><code>Markov()</code> is a Chain with transition diagram syntax. States reference emission distributions (variables or cells):</p>
          <table className="help-table">
            <tbody>
              <tr><td colSpan={2}><code>Markov(s0: 0.9 -&gt; s0, 0.1 -&gt; s1; s1: 0.3 -&gt; s0)</code></td></tr>
            </tbody>
          </table>
          <p className="help-note">Missing probability mass becomes a self-transition. Use <code>init stateName</code> to start in a specific state. Access steps with <code>chain[n]</code> or view the Timeline tab.</p>
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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the dialog on mount so keystrokes don't reach the grid behind it
  useEffect(() => { dialogRef.current?.focus(); }, []);

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
      <div className="dialog help-dialog" ref={dialogRef} tabIndex={-1} style={{ outline: "none" }} onClick={(e) => e.stopPropagation()}>
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
