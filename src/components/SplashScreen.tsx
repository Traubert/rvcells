import { useEffect } from "react";
import { examples } from "../examples";
import type { FileFormat } from "../engine/file";
import type { ChangelogEntry } from "../changelog";

interface SplashScreenProps {
  mode: "welcome" | "whats-new";
  newEntries: ChangelogEntry[];
  onDismiss: () => void;
  onLoadExample: (data: FileFormat) => void;
}

export function SplashScreen({ mode, newEntries, onDismiss, onLoadExample }: SplashScreenProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Enter") onDismiss();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onDismiss]);

  return (
    <div className="dialog-overlay" onClick={onDismiss}>
      <div className="dialog splash-dialog" onClick={(e) => e.stopPropagation()}>
        {mode === "welcome" ? (
          <>
            <div className="splash-hero">
              <img src="/favicon.svg" className="splash-logo" alt="" />
              <h2 className="splash-title">Welcome to <span className="splash-brand">rvcells</span></h2>
            </div>
            <p className="splash-text">
              A spreadsheet where cells can hold <strong>probability distributions</strong>,
              not just numbers. Type <code>Normal(100, 10)</code> into a cell and uncertainty
              propagates automatically through every formula that depends on it.
            </p>
            <section className="splash-section">
              <h3>A few things that work differently here</h3>
              <ul className="splash-list">
                <li><strong>Variables</strong> &mdash; name any cell: <code>income = Normal(5000, 800)</code></li>
                <li><strong>Label assignment</strong> &mdash; type a label in column A, then <code>:=</code> in column B to auto-name it</li>
                <li><strong>Chain loops</strong> &mdash; <code>x = Chain(x * growth, 1000)</code> runs an iterative process in one cell</li>
              </ul>
            </section>
            <section className="splash-section">
              <h3>Try an example</h3>
              <div className="splash-examples">
                {examples.map((ex) => (
                  <button
                    key={ex.name}
                    className="dialog-button splash-example-btn"
                    onClick={() => { onLoadExample(ex.data); onDismiss(); }}
                  >
                    {ex.name}
                  </button>
                ))}
              </div>
            </section>
            <p className="splash-hint">
              Press <strong>Ctrl+H</strong> for keyboard shortcuts, functions, and more examples.
            </p>
          </>
        ) : (
          <>
            <div className="splash-hero">
              <img src="/favicon.svg" className="splash-logo" alt="" />
              <h2 className="splash-title">Welcome back</h2>
            </div>
            <p className="splash-text">Here's what's new since your last visit:</p>
            <ul className="splash-changelog">
              {newEntries.map((entry) => (
                <li key={entry.version}>{entry.summary}</li>
              ))}
            </ul>
          </>
        )}
        <div className="dialog-actions">
          <button className="dialog-button splash-dismiss" onClick={onDismiss}>
            {mode === "welcome" ? "Get started" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
