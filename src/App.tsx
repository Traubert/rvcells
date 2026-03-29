import { useState, useCallback, useRef } from "react";
import { Grid } from "./components/Grid";
import { createSheet, recalculate } from "./engine/evaluate";
import { saveToFile, openFromFile } from "./engine/file";
import { SettingsDialog } from "./components/SettingsDialog";
import type { Sheet } from "./engine/types";
import "./App.css";

export default function App() {
  const sheetRef = useRef<Sheet>(createSheet(10_000));
  const [, setVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleSheetChange = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const handleSave = useCallback(() => {
    saveToFile(sheetRef.current);
    setMenuOpen(false);
  }, []);

  const handleOpen = useCallback(async () => {
    setMenuOpen(false);
    const sheet = await openFromFile();
    if (sheet) {
      sheetRef.current = sheet;
      setVersion((v) => v + 1);
    }
  }, []);

  const handleNameChange = useCallback((name: string) => {
    sheetRef.current.name = name;
    setVersion((v) => v + 1);
  }, []);

  const handleSettingsSave = useCallback((settings: { numSamples: number }) => {
    sheetRef.current.numSamples = settings.numSamples;
    recalculate(sheetRef.current);
    setSettingsOpen(false);
    setVersion((v) => v + 1);
  }, []);

  return (
    <div className="app" onClick={() => menuOpen && setMenuOpen(false)}>
      <header className="app-header">
        <div className="menu-container">
          <button
            className="menu-trigger"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          >
            rvcells <span className="menu-caret">&#9662;</span>
          </button>
          {menuOpen && (
            <div className="menu-dropdown">
              <button className="menu-item" onClick={handleOpen}>Import</button>
              <button className="menu-item" onClick={handleSave}>Export</button>
              <div className="menu-divider" />
              <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>Settings</button>
            </div>
          )}
        </div>
        <input
          className="sheet-name"
          value={sheetRef.current.name}
          onChange={(e) => handleNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
        />
      </header>
      <Grid sheet={sheetRef.current} onSheetChange={handleSheetChange} />
      {settingsOpen && (
        <SettingsDialog
          numSamples={sheetRef.current.numSamples}
          onSave={handleSettingsSave}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
