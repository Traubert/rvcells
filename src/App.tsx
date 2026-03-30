import { useState, useCallback, useRef } from "react";
import { Grid } from "./components/Grid";
import { TabBar } from "./components/TabBar";
import { createSheet, recalculate } from "./engine/evaluate";
import { saveToFile, openFromFile } from "./engine/file";
import { SettingsDialog } from "./components/SettingsDialog";
import { HelpDialog } from "./components/HelpDialog";
import type { Sheet } from "./engine/types";
import "./App.css";

function nextUntitledName(sheets: Sheet[]): string {
  const names = new Set(sheets.map((s) => s.name));
  if (!names.has("Untitled sheet")) return "Untitled sheet";
  for (let i = 2; ; i++) {
    const name = `Untitled sheet ${i}`;
    if (!names.has(name)) return name;
  }
}

export default function App() {
  const sheetsRef = useRef<Sheet[]>([createSheet(10_000)]);
  const nameRef = useRef("Untitled file");
  const [activeIndex, setActiveIndex] = useState(0);
  const [, setVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const activeSheet = sheetsRef.current[activeIndex];

  const handleSheetChange = bump;

  const handleSave = useCallback(() => {
    saveToFile(sheetsRef.current, nameRef.current);
    setMenuOpen(false);
  }, []);

  const handleOpen = useCallback(async () => {
    setMenuOpen(false);
    const result = await openFromFile();
    if (result) {
      sheetsRef.current = result.sheets;
      nameRef.current = result.name;
      setActiveIndex(0);
      bump();
    }
  }, [bump]);

  const handleNameChange = useCallback((name: string) => {
    nameRef.current = name;
    bump();
  }, [bump]);

  const handleSettingsSave = useCallback((settings: { numSamples: number }) => {
    for (const sheet of sheetsRef.current) {
      sheet.numSamples = settings.numSamples;
      recalculate(sheet);
    }
    setSettingsOpen(false);
    bump();
  }, [bump]);

  const handleTabSelect = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const handleTabRename = useCallback((index: number, name: string) => {
    sheetsRef.current[index].name = name;
    bump();
  }, [bump]);

  const handleTabClose = useCallback((index: number) => {
    if (sheetsRef.current.length <= 1) return;
    sheetsRef.current.splice(index, 1);
    setActiveIndex((prev) => {
      if (prev >= sheetsRef.current.length) return sheetsRef.current.length - 1;
      if (prev > index) return prev - 1;
      return prev;
    });
    bump();
  }, [bump]);

  const handleTabAdd = useCallback(() => {
    const name = nextUntitledName(sheetsRef.current);
    const numSamples = sheetsRef.current[0]?.numSamples ?? 10_000;
    sheetsRef.current.push(createSheet(numSamples, name));
    setActiveIndex(sheetsRef.current.length - 1);
    bump();
  }, [bump]);

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
              <button className="menu-item" onClick={() => { setHelpOpen(true); setMenuOpen(false); }}>Help</button>
            </div>
          )}
        </div>
        <input
          className="file-name"
          value={nameRef.current}
          onChange={(e) => handleNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
        />
      </header>
      <TabBar
        sheets={sheetsRef.current}
        activeIndex={activeIndex}
        onSelect={handleTabSelect}
        onRename={handleTabRename}
        onClose={handleTabClose}
        onAdd={handleTabAdd}
      />
      <Grid sheet={activeSheet} onSheetChange={handleSheetChange} onShowHelp={() => setHelpOpen(true)} />
      {helpOpen && (
        <HelpDialog onClose={() => setHelpOpen(false)} />
      )}
      {settingsOpen && (
        <SettingsDialog
          numSamples={activeSheet.numSamples}
          onSave={handleSettingsSave}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
