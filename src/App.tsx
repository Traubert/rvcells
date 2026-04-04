import { useState, useCallback, useRef, useEffect } from "react";
import { Grid } from "./components/Grid";
import { TabBar } from "./components/TabBar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { OpenDialog } from "./components/OpenDialog";
import { createSheet, recalculateAll, recalculateAllBulk, renameSheet, findRefsToSheet } from "./engine/evaluate";
import { saveToFile, openFromFile, serializeFile, deserializeFile } from "./engine/file";
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
import { DEFAULT_WORKBOOK_NAME, DEFAULT_SHEET_NAME, DEFAULT_NUM_SAMPLES } from "./constants";
import "./App.css";

function nextUntitledName(sheets: Sheet[]): string {
  const names = new Set(sheets.map((s) => s.name));
  if (!names.has(DEFAULT_SHEET_NAME)) return DEFAULT_SHEET_NAME;
  for (let i = 2; ; i++) {
    const name = `${DEFAULT_SHEET_NAME} ${i}`;
    if (!names.has(name)) return name;
  }
}

export default function App() {
  const sheetsRef = useRef<Sheet[]>([createSheet(DEFAULT_NUM_SAMPLES)]);
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
  const [splash, setSplash] = useState<{ mode: "welcome" | "whats-new" | "changelog"; newEntries: ChangelogEntry[] } | null>(() => {
    const last = getLastSeenVersion();
    if (last === null) return { mode: "welcome", newEntries: [] };
    if (last < CURRENT_VERSION) return { mode: "whats-new", newEntries: changelog.filter((e) => e.version > last) };
    return null;
  });

  const bump = useCallback(() => setVersion((v) => v + 1), []);

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
      bump();
    }
    setEditingName(false);
  }, [editNameValue, bump]);

  const activeSheet = sheetsRef.current[activeIndex];

  const handleSheetChange = bump;

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
    const numSamples = sheetsRef.current[0]?.numSamples ?? DEFAULT_NUM_SAMPLES;
    sheetsRef.current = [createSheet(numSamples)];
    nameRef.current = name;
    workbookIdRef.current = null;
    setActiveIndex(0);
    bump();
  }, [bump]);

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
    const data = serializeFile(sheetsRef.current, nameRef.current);
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
    nameRef.current = result.name;
    workbookIdRef.current = id;
    setActiveIndex(0);
    setOpenDialogOpen(false);
    bump();
  }, [bump]);

  // File export (download)
  const handleExport = useCallback(() => {
    saveToFile(sheetsRef.current, nameRef.current);
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
    const uniqueName = uniqueWorkbookName(result.name);
    if (uniqueName !== result.name) {
      showRenameNotice([{ from: result.name, to: uniqueName }]);
    }
    nameRef.current = uniqueName;
    workbookIdRef.current = null; // imported file has no storage id yet
    setActiveIndex(0);
    bump();
  }, [bump, showRenameNotice]);

  const handleLoadExample = useCallback((data: FileFormat) => {
    const result = deserializeFile(data);
    sheetsRef.current = result.sheets;
    nameRef.current = result.name;
    workbookIdRef.current = null;
    setActiveIndex(0);
    bump();
  }, [bump]);

  const handleDismissSplash = useCallback(() => {
    setLastSeenVersion(CURRENT_VERSION);
    setSplash(null);
  }, []);

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


  const handleSettingsSave = useCallback((settings: { numSamples: number }) => {
    for (const sheet of sheetsRef.current) {
      sheet.numSamples = settings.numSamples;
    }
    recalculateAll(sheetsRef.current);
    setSettingsOpen(false);
    bump();
  }, [bump]);

  const handleTabSelect = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const handleTabRename = useCallback((index: number, name: string) => {
    renameSheet(sheetsRef.current, index, name);
    bump();
  }, [bump]);

  const doDeleteSheet = useCallback((index: number) => {
    sheetsRef.current.splice(index, 1);
    setActiveIndex((prev) => {
      if (prev >= sheetsRef.current.length) return sheetsRef.current.length - 1;
      if (prev > index) return prev - 1;
      return prev;
    });
    recalculateAllBulk(sheetsRef.current);
    bump();
  }, [bump]);

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

  const handleTabAdd = useCallback(() => {
    const name = nextUntitledName(sheetsRef.current);
    const numSamples = sheetsRef.current[0]?.numSamples ?? DEFAULT_NUM_SAMPLES;
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
      />
      <Grid
        sheet={activeSheet}
        allSheets={sheetsRef.current}
        sheetIndex={activeIndex}
        onSheetChange={handleSheetChange}
        onShowHelp={() => setHelpOpen(true)}
        onSave={handleStorageSave}
        onOpen={handleStorageOpen}
      />
      {helpOpen && (
        <HelpDialog onClose={() => setHelpOpen(false)} onLoadExample={handleLoadExample} />
      )}
      {aboutOpen && (
        <AboutDialog
          onClose={() => setAboutOpen(false)}
          onShowWelcome={() => setSplash({ mode: "welcome", newEntries: [] })}
          onShowChangelog={() => setSplash({ mode: "changelog", newEntries: changelog })}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          numSamples={activeSheet.numSamples}
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
    </div>
  );
}
