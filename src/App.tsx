import { useState, useCallback, useRef, useEffect } from "react";
import { Grid } from "./components/Grid";
import { TabBar } from "./components/TabBar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { OpenDialog } from "./components/OpenDialog";
import { createSheet, recalculateAll, recalculateAllBulk, renameSheet, findRefsToSheet, DEFAULT_SETTINGS } from "./engine/evaluate";
import { saveToFile, openFromFile, serializeFile, deserializeFile } from "./engine/file";
import type { WorkbookSettings } from "./engine/types";
import { storageAvailable, saveWorkbook, loadWorkbook, listWorkbooks, generateId, uniqueWorkbookName, exportAllAsZip, importFromZip } from "./engine/storage";
import type { WorkbookEntry } from "./engine/storage";
import { SettingsDialog } from "./components/SettingsDialog";
import { HelpDialog } from "./components/HelpDialog";
import { AboutDialog } from "./components/AboutDialog";
import { SplashScreen } from "./components/SplashScreen";
import type { Sheet } from "./engine/types";
import type { FileFormat } from "./engine/file";
import { changelog, CURRENT_VERSION, getLastSeenVersion, setLastSeenVersion } from "./changelog";
import type { ChangelogEntry } from "./changelog";
import { DEFAULT_WORKBOOK_NAME, DEFAULT_SHEET_NAME } from "./constants";
import "./App.css";

const AUTOSAVE_KEY = "rvcells:autosave";

function getAutosave(): boolean {
  try {
    const v = localStorage.getItem(AUTOSAVE_KEY);
    return v !== "false"; // default true
  } catch { return true; }
}

function setAutosave(on: boolean) {
  try { localStorage.setItem(AUTOSAVE_KEY, String(on)); } catch {}
}

type Snapshot = {
  name: string;
  settings: WorkbookSettings;
  activeIndex: number;
  sheets: Array<{ name: string; cells: Record<string, string> }>;
};

const MAX_HISTORY = 100;

function nextUntitledName(sheets: Sheet[]): string {
  const names = new Set(sheets.map((s) => s.name));
  if (!names.has(DEFAULT_SHEET_NAME)) return DEFAULT_SHEET_NAME;
  for (let i = 2; ; i++) {
    const name = `${DEFAULT_SHEET_NAME} ${i}`;
    if (!names.has(name)) return name;
  }
}

export default function App() {
  const sheetsRef = useRef<Sheet[]>([createSheet()]);
  const settingsRef = useRef<WorkbookSettings>({ ...DEFAULT_SETTINGS });
  const nameRef = useRef(DEFAULT_WORKBOOK_NAME);
  const workbookIdRef = useRef<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [, setVersion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [openDialogWorkbooks, setOpenDialogWorkbooks] = useState<WorkbookEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<{ index: number; message: string } | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [renameNotice, setRenameNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const autosaveRef = useRef(getAutosave());
  const [splash, setSplash] = useState<{ mode: "welcome" | "whats-new" | "changelog"; newEntries: ChangelogEntry[] } | null>(() => {
    const last = getLastSeenVersion();
    if (last === null) return { mode: "welcome", newEntries: [] };
    if (last < CURRENT_VERSION) return { mode: "whats-new", newEntries: changelog.filter((e) => e.version > last) };
    return null;
  });

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Undo/redo history
  const activeIndexRef = useRef(0);
  const historyRef = useRef<Snapshot[]>([]);
  const historyHeadRef = useRef(-1);

  const setActiveIdx = useCallback((idx: number) => {
    activeIndexRef.current = idx;
    setActiveIndex(idx);
  }, []);

  // These plain functions only access stable refs, so they work correctly
  // even when captured in useCallback closures.
  function takeSnapshot(): Snapshot {
    return {
      name: nameRef.current,
      settings: { ...settingsRef.current },
      activeIndex: activeIndexRef.current,
      sheets: sheetsRef.current.map((sheet) => {
        const cells: Record<string, string> = {};
        for (const [addr, cell] of sheet.cells) cells[addr] = cell.raw;
        return { name: sheet.name, cells };
      }),
    };
  }

  function pushSnapshot() {
    const snap = takeSnapshot();
    const head = historyHeadRef.current;
    if (head >= 0) {
      const prev = historyRef.current[head];
      if (JSON.stringify(snap) === JSON.stringify(prev)) return;
    }
    historyRef.current.splice(head + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyHeadRef.current = historyRef.current.length - 1;
  }

  function resetHistory() {
    historyRef.current = [takeSnapshot()];
    historyHeadRef.current = 0;
  }

  const restoreSnapshot = useCallback((snap: Snapshot) => {
    const fileFormat: FileFormat = {
      version: 2,
      name: snap.name,
      settings: snap.settings,
      sheets: snap.sheets,
    };
    const result = deserializeFile(fileFormat);
    sheetsRef.current = result.sheets;
    settingsRef.current = result.settings;
    nameRef.current = result.name;
    activeIndexRef.current = snap.activeIndex;
    setActiveIndex(snap.activeIndex);
    bump();
  }, [bump]);

  const undo = useCallback(() => {
    if (historyHeadRef.current > 0) {
      historyHeadRef.current--;
      restoreSnapshot(historyRef.current[historyHeadRef.current]);
    }
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    if (historyHeadRef.current < historyRef.current.length - 1) {
      historyHeadRef.current++;
      restoreSnapshot(historyRef.current[historyHeadRef.current]);
    }
  }, [restoreSnapshot]);

  const commitChange = useCallback(() => {
    pushSnapshot();
    // Autosave: silently persist if the workbook has a storage entry
    if (autosaveRef.current && workbookIdRef.current) {
      const data = serializeFile(sheetsRef.current, nameRef.current, settingsRef.current);
      saveWorkbook(workbookIdRef.current, nameRef.current, data);
    }
    bump();
  }, [bump]);

  // Initialize undo history on mount
  useEffect(() => {
    resetHistory();
  }, []);

  // Check storage availability on mount
  useEffect(() => {
    const check = storageAvailable();
    if (!check.ok) {
      setStorageWarning(check.reason!);
    }
  }, []);

  // Focus and select workbook name input when entering edit mode
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  const commitNameEdit = useCallback(() => {
    const trimmed = editNameValue.trim();
    if (trimmed && trimmed !== nameRef.current) {
      nameRef.current = trimmed;
      commitChange();
    }
    setEditingName(false);
  }, [editNameValue, commitChange]);

  const activeSheet = sheetsRef.current[activeIndex];

  const handleSheetChange = commitChange;

  /** Show a rename notice that auto-dismisses after 4 seconds. Reusable for mass import. */
  const showRenameNotice = useCallback((renames: Array<{ from: string; to: string }>) => {
    if (renames.length === 0) return;
    if (renames.length === 1) {
      setRenameNotice(`Renamed "${renames[0].from}" to "${renames[0].to}" to avoid a name conflict.`);
    } else {
      setRenameNotice(`Renamed ${renames.length} files to avoid name conflicts.`);
    }
    setTimeout(() => setRenameNotice(null), 4000);
  }, []);

  // New file
  const handleNewFile = useCallback(() => {
    setMenuOpen(false);
    const name = uniqueWorkbookName(DEFAULT_WORKBOOK_NAME);
    sheetsRef.current = [createSheet()];
    settingsRef.current = { ...DEFAULT_SETTINGS };
    nameRef.current = name;
    workbookIdRef.current = null;
    setActiveIdx(0);
    resetHistory();
    bump();
  }, [bump, setActiveIdx]);

  // Save to browser storage
  const handleStorageSave = useCallback(() => {
    setMenuOpen(false);
    const check = storageAvailable();
    if (!check.ok) {
      setStorageWarning(check.reason!);
      return;
    }
    if (!workbookIdRef.current) {
      workbookIdRef.current = generateId();
    }
    const data = serializeFile(sheetsRef.current, nameRef.current, settingsRef.current);
    const result = saveWorkbook(workbookIdRef.current, nameRef.current, data);
    if (!result.ok) {
      setStorageWarning(result.reason!);
    } else {
      setStorageWarning(null);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    }
  }, []);

  // Open from browser storage
  const handleStorageOpen = useCallback(() => {
    setMenuOpen(false);
    const check = storageAvailable();
    if (!check.ok) {
      setStorageWarning(check.reason!);
      return;
    }
    setOpenDialogWorkbooks(listWorkbooks());
    setOpenDialogOpen(true);
  }, []);

  const handleOpenWorkbook = useCallback((id: string) => {
    const data = loadWorkbook(id);
    if (!data) {
      setImportError("Failed to load workbook from browser storage.");
      setOpenDialogOpen(false);
      return;
    }
    const result = deserializeFile(data);
    sheetsRef.current = result.sheets;
    settingsRef.current = result.settings;
    nameRef.current = result.name;
    workbookIdRef.current = id;
    setActiveIdx(0);
    resetHistory();
    setOpenDialogOpen(false);
    bump();
  }, [bump, setActiveIdx]);

  // File export (download)
  const handleExport = useCallback(() => {
    saveToFile(sheetsRef.current, nameRef.current, settingsRef.current);
    setMenuOpen(false);
  }, []);

  // File import (upload)
  const handleImport = useCallback(async () => {
    setMenuOpen(false);
    const result = await openFromFile();
    if (!result) return;
    if ("error" in result) {
      setImportError(result.error);
      return;
    }
    sheetsRef.current = result.sheets;
    settingsRef.current = result.settings;
    const uniqueName = uniqueWorkbookName(result.name);
    if (uniqueName !== result.name) {
      showRenameNotice([{ from: result.name, to: uniqueName }]);
    }
    nameRef.current = uniqueName;
    workbookIdRef.current = null; // imported file has no storage id yet
    setActiveIdx(0);
    resetHistory();
    bump();
  }, [bump, setActiveIdx, showRenameNotice]);

  const handleLoadExample = useCallback((data: FileFormat) => {
    const result = deserializeFile(data);
    sheetsRef.current = result.sheets;
    settingsRef.current = result.settings;
    nameRef.current = result.name;
    workbookIdRef.current = null;
    setActiveIdx(0);
    resetHistory();
    bump();
  }, [bump, setActiveIdx]);

  const handleDismissSplash = useCallback(() => {
    setLastSeenVersion(CURRENT_VERSION);
    setSplash(null);
  }, []);

  // Global keyboard shortcuts (work regardless of focus)
  // Escape dismisses the topmost dialog in render order.
  const escapeStackRef = useRef<(() => void)[]>([]);
  useEffect(() => {
    const stack: (() => void)[] = [];
    if (settingsOpen) stack.push(() => setSettingsOpen(false));
    if (openDialogOpen) stack.push(() => setOpenDialogOpen(false));
    if (aboutOpen) stack.push(() => setAboutOpen(false));
    if (splash) stack.push(handleDismissSplash);
    if (helpOpen) stack.push(() => setHelpOpen(false));
    escapeStackRef.current = stack;
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const stack = escapeStackRef.current;
        if (stack.length > 0) {
          e.preventDefault();
          stack[stack.length - 1]();
          return;
        }
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const key = e.key.toLowerCase();
      // Undo/redo: skip when an input or textarea is focused (let browser handle text undo)
      if (key === "z" || key === "y") {
        const tag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        if (key === "z" && e.shiftKey) redo();
        else if (key === "z") undo();
        else redo(); // Ctrl+Y
        return;
      }
      switch (key) {
        case "h":
          e.preventDefault();
          setHelpOpen(true);
          break;
        case "s":
          e.preventDefault();
          handleStorageSave();
          break;
        case "o":
          e.preventDefault();
          handleStorageOpen();
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleStorageSave, handleStorageOpen, handleDismissSplash, undo, redo]);

  // Mass export all saved workbooks as zip
  const handleMassExport = useCallback(async () => {
    setMenuOpen(false);
    const error = await exportAllAsZip();
    if (error) setImportError(error);
  }, []);

  // Mass import workbooks from zip
  const handleMassImport = useCallback(async () => {
    setMenuOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const result = await importFromZip(file);
      if (result.errors.length > 0) {
        setImportError(result.errors.join(" "));
      }
      if (result.imported > 0) {
        showRenameNotice(result.renames);
        setSaveFlash(true);
        setTimeout(() => setSaveFlash(false), 1500);
      }
    };
    input.click();
  }, [showRenameNotice]);


  const handleSettingsSave = useCallback((newSettings: { numSamples: number; chainSearchLimit: number; autosave: boolean }) => {
    settingsRef.current = { numSamples: newSettings.numSamples, chainSearchLimit: newSettings.chainSearchLimit };
    autosaveRef.current = newSettings.autosave;
    setAutosave(newSettings.autosave);
    recalculateAll(sheetsRef.current, settingsRef.current);
    setSettingsOpen(false);
    commitChange();
  }, [commitChange]);

  const handleTabSelect = useCallback((index: number) => {
    setActiveIdx(index);
  }, [setActiveIdx]);

  const handleTabRename = useCallback((index: number, name: string) => {
    renameSheet(sheetsRef.current, index, name);
    commitChange();
  }, [commitChange]);

  const doDeleteSheet = useCallback((index: number) => {
    sheetsRef.current.splice(index, 1);
    let newIdx = activeIndexRef.current;
    if (newIdx >= sheetsRef.current.length) newIdx = sheetsRef.current.length - 1;
    else if (newIdx > index) newIdx = newIdx - 1;
    setActiveIdx(newIdx);
    recalculateAllBulk(sheetsRef.current);
    commitChange();
  }, [commitChange, setActiveIdx]);

  const handleTabClose = useCallback((index: number) => {
    if (sheetsRef.current.length <= 1) return;

    const sheetName = sheetsRef.current[index].name;
    const refs = findRefsToSheet(sheetsRef.current, sheetName);
    const externalRefs = refs.filter((r) => r.sheetIndex !== index);

    if (externalRefs.length > 0) {
      const n = externalRefs.length;
      const first = externalRefs[0];
      const refSheet = sheetsRef.current[first.sheetIndex].name;
      const cellWord = n === 1 ? "1 cell" : `${n} cells`;
      const msg = `Sheet "${sheetName}" is referenced by ${cellWord} in other sheets (first reference: ${refSheet}.${first.addr}). Delete anyway?`;
      setConfirmDelete({ index, message: msg });
    } else {
      doDeleteSheet(index);
    }
  }, [doDeleteSheet]);

  const handleTabReorder = useCallback((fromIndex: number, toIndex: number) => {
    const sheets = sheetsRef.current;
    const [moved] = sheets.splice(fromIndex, 1);
    sheets.splice(toIndex, 0, moved);
    // Keep the active sheet the same after reorder
    let newActive = activeIndexRef.current;
    if (newActive === fromIndex) {
      newActive = toIndex;
    } else if (fromIndex < newActive && toIndex >= newActive) {
      newActive--;
    } else if (fromIndex > newActive && toIndex <= newActive) {
      newActive++;
    }
    setActiveIdx(newActive);
    commitChange();
  }, [commitChange, setActiveIdx]);

  const handleTabAdd = useCallback(() => {
    const name = nextUntitledName(sheetsRef.current);
    sheetsRef.current.push(createSheet(name));
    setActiveIdx(sheetsRef.current.length - 1);
    commitChange();
  }, [commitChange, setActiveIdx]);

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
              <button className="menu-item" onClick={handleNewFile}>New</button>
              <button className="menu-item" onClick={handleStorageOpen}>Open<span className="menu-shortcut">Ctrl+O</span></button>
              <button className="menu-item" onClick={handleStorageSave}>Save<span className="menu-shortcut">Ctrl+S</span></button>
              <div className="menu-divider" />
              <button className="menu-item" onClick={handleImport}>Import from file</button>
              <button className="menu-item" onClick={handleExport}>Export as file</button>
              <button className="menu-item" onClick={handleMassImport}>Import all from zip</button>
              <button className="menu-item" onClick={handleMassExport}>Export all as zip</button>
              <div className="menu-divider" />
              <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>Settings</button>
              <button className="menu-item" onClick={() => { setAboutOpen(true); setMenuOpen(false); }}>About</button>
              <button className="menu-item" onClick={() => { setHelpOpen(true); setMenuOpen(false); }}>Help</button>
            </div>
          )}
        </div>
        {editingName ? (
          <input
            ref={nameInputRef}
            className="file-name file-name-editing"
            value={editNameValue}
            onChange={(e) => setEditNameValue(e.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNameEdit();
              if (e.key === "Escape") setEditingName(false);
            }}
            spellCheck={false}
          />
        ) : (
          <span
            className="file-name"
            onDoubleClick={() => {
              setEditNameValue(nameRef.current);
              setEditingName(true);
            }}
          >
            {nameRef.current}
          </span>
        )}
        {saveFlash && <span className="save-flash">Saved</span>}
        {renameNotice && <span className="rename-notice">{renameNotice}</span>}
      </header>
      {storageWarning && (
        <div className="storage-warning">
          ⚠ {storageWarning} Your work exists only in this tab. Use Export to save a file.
          <button className="storage-warning-dismiss" onClick={() => setStorageWarning(null)}>×</button>
        </div>
      )}
      {importError && (
        <div className="import-error-banner">
          {importError}
          <button className="storage-warning-dismiss" onClick={() => setImportError(null)}>×</button>
        </div>
      )}
      <TabBar
        sheets={sheetsRef.current}
        activeIndex={activeIndex}
        onSelect={handleTabSelect}
        onRename={handleTabRename}
        onClose={handleTabClose}
        onAdd={handleTabAdd}
        onReorder={handleTabReorder}
      />
      <Grid
        sheet={activeSheet}
        allSheets={sheetsRef.current}
        sheetIndex={activeIndex}
        settings={settingsRef.current}
        onSheetChange={handleSheetChange}
        onShowHelp={() => setHelpOpen(true)}
        onSave={handleStorageSave}
        onOpen={handleStorageOpen}
      />
      {aboutOpen && (
        <AboutDialog
          onClose={() => setAboutOpen(false)}
          onShowWelcome={() => setSplash({ mode: "welcome", newEntries: [] })}
          onShowChangelog={() => setSplash({ mode: "changelog", newEntries: changelog })}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          numSamples={settingsRef.current.numSamples}
          chainSearchLimit={settingsRef.current.chainSearchLimit}
          autosave={autosaveRef.current}
          onSave={handleSettingsSave}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {openDialogOpen && (
        <OpenDialog
          workbooks={openDialogWorkbooks}
          currentId={workbookIdRef.current}
          onOpen={handleOpenWorkbook}
          onClose={() => setOpenDialogOpen(false)}
          onRefresh={() => setOpenDialogWorkbooks(listWorkbooks())}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          message={confirmDelete.message}
          onConfirm={() => {
            doDeleteSheet(confirmDelete.index);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {splash && (
        <SplashScreen
          mode={splash.mode}
          newEntries={splash.newEntries}
          onDismiss={handleDismissSplash}
          onLoadExample={handleLoadExample}
        />
      )}
      {helpOpen && (
        <HelpDialog onClose={() => setHelpOpen(false)} onLoadExample={handleLoadExample} />
      )}
    </div>
  );
}
