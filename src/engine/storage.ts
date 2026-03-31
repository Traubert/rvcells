import JSZip from "jszip";
import type { FileFormat } from "./file";

const PREFIX = "rvcells:";
const INDEX_KEY = PREFIX + "index";
const WB_PREFIX = PREFIX + "workbook:";

export interface WorkbookEntry {
  id: string;
  name: string;
  lastModified: number; // epoch ms
}

/** Check if localStorage is available and writable. */
export function storageAvailable(): { ok: boolean; reason?: string } {
  try {
    if (typeof localStorage === "undefined") {
      return { ok: false, reason: "localStorage is not available in this environment." };
    }
    const testKey = PREFIX + "__test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof DOMException && e.name === "QuotaExceededError"
      ? "Browser storage is full."
      : "Browser storage is blocked (private browsing or permissions).";
    return { ok: false, reason: msg };
  }
}

function readIndex(): WorkbookEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: WorkbookEntry[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

/** List all saved workbooks, most recently modified first. */
export function listWorkbooks(): WorkbookEntry[] {
  return readIndex().sort((a, b) => b.lastModified - a.lastModified);
}

/** Save a workbook to localStorage. Creates or updates by id. */
export function saveWorkbook(id: string, name: string, data: FileFormat): { ok: boolean; reason?: string } {
  try {
    localStorage.setItem(WB_PREFIX + id, JSON.stringify(data));
    const index = readIndex();
    const existing = index.find((e) => e.id === id);
    if (existing) {
      existing.name = name;
      existing.lastModified = Date.now();
    } else {
      index.push({ id, name, lastModified: Date.now() });
    }
    writeIndex(index);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof DOMException && e.name === "QuotaExceededError"
      ? "Browser storage is full. Export your file to avoid data loss."
      : "Failed to save to browser storage.";
    return { ok: false, reason: msg };
  }
}

/** Load a workbook by id. Returns null if not found. */
export function loadWorkbook(id: string): FileFormat | null {
  try {
    const raw = localStorage.getItem(WB_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Delete a workbook by id. */
export function deleteWorkbook(id: string): void {
  localStorage.removeItem(WB_PREFIX + id);
  const index = readIndex().filter((e) => e.id !== id);
  writeIndex(index);
}

/** Rename a workbook in the index (does not modify the stored data). */
export function renameWorkbook(id: string, newName: string): void {
  const index = readIndex();
  const entry = index.find((e) => e.id === id);
  if (entry) {
    entry.name = newName;
    writeIndex(index);
  }
}

/** Generate a short random id for new workbooks. */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Find a unique workbook name, appending a number if needed.
 *  Takes an optional set of additional names to avoid (for batch imports). */
export function uniqueWorkbookName(desired: string, extraNames?: Set<string>): string {
  const names = new Set(readIndex().map((e) => e.name));
  if (extraNames) for (const n of extraNames) names.add(n);
  if (!names.has(desired)) return desired;
  for (let i = 2; ; i++) {
    const candidate = `${desired} ${i}`;
    if (!names.has(candidate)) return candidate;
  }
}

/** Export all saved workbooks as a zip file download. Returns error message if none to export. */
export async function exportAllAsZip(): Promise<string | null> {
  const index = readIndex();
  if (index.length === 0) {
    return "No saved workbooks to export.";
  }
  const zip = new JSZip();
  // Deduplicate filenames within the zip (different workbooks could share a name)
  const usedFilenames = new Set<string>();
  for (const entry of index) {
    const data = loadWorkbook(entry.id);
    if (!data) continue;
    let filename = entry.name;
    if (usedFilenames.has(filename)) {
      for (let i = 2; ; i++) {
        const candidate = `${filename} ${i}`;
        if (!usedFilenames.has(candidate)) { filename = candidate; break; }
      }
    }
    usedFilenames.add(filename);
    zip.file(filename + ".json", JSON.stringify(data, null, 2));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rvcells-workbooks.zip";
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

/** Import workbooks from a zip file. Returns renames for notification. */
export async function importFromZip(file: File): Promise<{
  imported: number;
  renames: Array<{ from: string; to: string }>;
  errors: string[];
}> {
  const zip = await JSZip.loadAsync(file);
  const renames: Array<{ from: string; to: string }> = [];
  const errors: string[] = [];
  let imported = 0;
  // Track names used within this batch to avoid collisions between zip entries
  const batchNames = new Set<string>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.endsWith(".json")) continue;
    try {
      const text = await entry.async("string");
      const data = JSON.parse(text) as FileFormat;
      if (data.version !== 2 || !Array.isArray(data.sheets)) {
        errors.push(`${path}: invalid file format`);
        continue;
      }
      const originalName = data.name || path.replace(/\.json$/, "");
      const uniqueName = uniqueWorkbookName(originalName, batchNames);
      if (uniqueName !== originalName) {
        renames.push({ from: originalName, to: uniqueName });
      }
      batchNames.add(uniqueName);
      data.name = uniqueName;
      const id = generateId();
      const result = saveWorkbook(id, uniqueName, data);
      if (!result.ok) {
        errors.push(`${originalName}: ${result.reason}`);
        continue;
      }
      imported++;
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`);
    }
  }
  return { imported, renames, errors };
}
