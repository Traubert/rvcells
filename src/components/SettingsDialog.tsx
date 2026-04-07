import { useState, useEffect } from "react";
import { MIN_NUM_SAMPLES, MAX_NUM_SAMPLES, MIN_CHAIN_SEARCH_LIMIT, MAX_CHAIN_SEARCH_LIMIT } from "../constants";
import type { ThemePref, ResolvedTheme } from "../App";

interface SettingsDialogProps {
  numSamples: number;
  chainSearchLimit: number;
  autosave: boolean;
  theme: ThemePref;
  onSave: (settings: { numSamples: number; chainSearchLimit: number; autosave: boolean; theme: ThemePref }) => void;
  onClose: () => void;
}

function getSystemTheme(): ResolvedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch { return "dark"; }
}

export function SettingsDialog({ numSamples, chainSearchLimit, autosave, theme, onSave, onClose }: SettingsDialogProps) {
  const [samples, setSamples] = useState(String(numSamples));
  const [searchLimit, setSearchLimit] = useState(String(chainSearchLimit));
  const [autoSaveLocal, setAutoSaveLocal] = useState(autosave);
  const [themeLocal, setThemeLocal] = useState<ThemePref>(theme);
  const [sysTheme, setSysTheme] = useState<ResolvedTheme>(getSystemTheme);
  const [hint, setHint] = useState<string | null>(null);

  // Live-update the Auto hint if the OS theme changes while the dialog is open
  useEffect(() => {
    let mql: MediaQueryList;
    try { mql = window.matchMedia("(prefers-color-scheme: light)"); } catch { return; }
    const handler = (e: MediaQueryListEvent) => setSysTheme(e.matches ? "light" : "dark");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  function showHint(msg: string) {
    setHint(msg);
    setTimeout(() => setHint(null), 3000);
  }

  function handleSave() {
    const n = parseInt(samples, 10);
    if (isNaN(n) || String(n) !== samples.trim()) {
      setSamples(String(numSamples));
      showHint("Not a valid integer — reverted.");
      return;
    }
    if (n < MIN_NUM_SAMPLES) {
      setSamples(String(MIN_NUM_SAMPLES));
      showHint(`Clamped to minimum (${MIN_NUM_SAMPLES.toLocaleString()}).`);
      return;
    }
    if (n > MAX_NUM_SAMPLES) {
      setSamples(String(MAX_NUM_SAMPLES));
      showHint(`Clamped to maximum (${MAX_NUM_SAMPLES.toLocaleString()}).`);
      return;
    }
    const limit = parseInt(searchLimit, 10);
    if (isNaN(limit) || String(limit) !== searchLimit.trim()) {
      setSearchLimit(String(chainSearchLimit));
      showHint("Not a valid integer — reverted.");
      return;
    }
    if (limit < MIN_CHAIN_SEARCH_LIMIT) {
      setSearchLimit(String(MIN_CHAIN_SEARCH_LIMIT));
      showHint(`Clamped to minimum (${MIN_CHAIN_SEARCH_LIMIT.toLocaleString()}).`);
      return;
    }
    if (limit > MAX_CHAIN_SEARCH_LIMIT) {
      setSearchLimit(String(MAX_CHAIN_SEARCH_LIMIT));
      showHint(`Clamped to maximum (${MAX_CHAIN_SEARCH_LIMIT.toLocaleString()}).`);
      return;
    }
    onSave({ numSamples: n, chainSearchLimit: limit, autosave: autoSaveLocal, theme: themeLocal });
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <h3 className="settings-section-header">Workbook</h3>
        <div className="dialog-field">
          <label htmlFor="num-samples">Sample count</label>
          <input
            id="num-samples"
            type="number"
            value={samples}
            onChange={(e) => setSamples(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            min={MIN_NUM_SAMPLES}
            max={MAX_NUM_SAMPLES}
            step={1000}
          />
        </div>
        <div className="dialog-field">
          <label htmlFor="chain-search-limit">ChainIndex search limit</label>
          <input
            id="chain-search-limit"
            type="number"
            value={searchLimit}
            onChange={(e) => setSearchLimit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            min={MIN_CHAIN_SEARCH_LIMIT}
            max={MAX_CHAIN_SEARCH_LIMIT}
            step={100}
          />
          <span className="dialog-hint">Maximum steps ChainIndex() will search before returning an error.</span>
        </div>
        {hint && <span className="dialog-hint dialog-hint-warn">{hint}</span>}

        <h3 className="settings-section-header">Global</h3>
        <div className="dialog-field">
          <label className="settings-checkbox-label">
            <input
              id="autosave"
              type="checkbox"
              checked={autoSaveLocal}
              onChange={(e) => setAutoSaveLocal(e.target.checked)}
            />
            Autosave
          </label>
          <span className="dialog-hint">Automatically save to browser storage on each edit (only for previously saved workbooks).</span>
        </div>
        <div className="dialog-field">
          <label>Theme</label>
          <div className="theme-toggle">
            {(["auto", "dark", "light"] as ThemePref[]).map((opt) => (
              <button
                key={opt}
                type="button"
                className={`theme-toggle-btn${themeLocal === opt ? " theme-toggle-btn-active" : ""}`}
                onClick={() => setThemeLocal(opt)}
              >
                {opt[0].toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
          <span className="dialog-hint">
            {themeLocal === "auto" ? `Follow system preference (currently ${sysTheme}).` : `Always use ${themeLocal} theme.`}
          </span>
        </div>

        <div className="dialog-actions">
          <button className="dialog-button" onClick={onClose}>Cancel</button>
          <button className="dialog-button dialog-button-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
