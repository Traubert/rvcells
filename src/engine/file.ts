import type { Sheet, CellAddress, WorkbookSettings } from "./types";
import { parseCell } from "./parser";
import { recalculateAllBulk, createSheet } from "./evaluate";
import { DEFAULT_WORKBOOK_NAME, DEFAULT_SHEET_NAME, DEFAULT_NUM_SAMPLES, DEFAULT_CHAIN_SEARCH_LIMIT } from "../constants";

/** On-disk format — settings are sparse: only non-default values are stored */
export interface FileFormat {
  version: number;
  name?: string;
  settings?: {
    numSamples?: number;
    chainSearchLimit?: number;
  };
  sheets: Array<{
    name: string;
    cells: Record<string, string>; // addr → raw text
  }>;
}

/** Serialize multiple sheets to a saveable JSON object.
 *  Settings are sparse — only non-default values are written. */
export function serializeFile(sheets: Sheet[], name: string, settings: WorkbookSettings): FileFormat {
  const sparse: FileFormat["settings"] = {};
  if (settings.numSamples !== DEFAULT_NUM_SAMPLES) sparse.numSamples = settings.numSamples;
  if (settings.chainSearchLimit !== DEFAULT_CHAIN_SEARCH_LIMIT) sparse.chainSearchLimit = settings.chainSearchLimit;
  return {
    version: 2,
    name,
    ...(Object.keys(sparse).length > 0 ? { settings: sparse } : {}),
    sheets: sheets.map((sheet) => {
      const cells: Record<string, string> = {};
      for (const [addr, cell] of sheet.cells) {
        cells[addr] = cell.raw;
      }
      return { name: sheet.name, cells };
    }),
  };
}

/** Deserialize a file into a name, array of sheets, and settings. */
export function deserializeFile(file: FileFormat): { name: string; sheets: Sheet[]; settings: WorkbookSettings } {
  const settings: WorkbookSettings = {
    numSamples: file.settings?.numSamples ?? DEFAULT_NUM_SAMPLES,
    chainSearchLimit: file.settings?.chainSearchLimit ?? DEFAULT_CHAIN_SEARCH_LIMIT,
  };
  const fileName = file.name || DEFAULT_WORKBOOK_NAME;

  if (!file.sheets?.length) {
    return { name: fileName, sheets: [createSheet()], settings };
  }

  // Deduplicate sheet names: first occurrence keeps its name, duplicates get renamed
  const usedNames = new Set<string>();
  let nextNum = 1;
  const sheets = file.sheets.map((sheetData) => {
    let name = sheetData.name || DEFAULT_SHEET_NAME;
    if (usedNames.has(name)) {
      // Find a unique name
      while (usedNames.has(`${DEFAULT_SHEET_NAME} ${nextNum}`)) nextNum++;
      name = `${DEFAULT_SHEET_NAME} ${nextNum}`;
      nextNum++;
    }
    usedNames.add(name);
    const sheet = createSheet(name);

    for (const [addr, raw] of Object.entries(sheetData.cells)) {
      const { content, variableName, labelVar } = parseCell(raw);
      sheet.cells.set(addr as CellAddress, { raw, content, variableName, labelVar });
    }

    return sheet;
  });

  // Bulk recalculate all sheets together for cross-sheet references
  recalculateAllBulk(sheets, settings);

  return { name: fileName, sheets, settings };
}

/** Save sheets as a JSON file download */
export function saveToFile(sheets: Sheet[], name: string, settings: WorkbookSettings): void {
  const data = serializeFile(sheets, name, settings);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a file picker and load sheets. Returns null if user cancels.
 *  On parse failure, returns { error } with a user-facing message. */
export function openFromFile(): Promise<{ name: string; sheets: Sheet[]; settings: WorkbookSettings } | { error: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text) as FileFormat;
        if (data.version !== 2 || !Array.isArray(data.sheets)) {
          throw new Error("not a valid rvcells file");
        }
        resolve(deserializeFile(data));
      } catch {
        resolve({ error: `Could not parse "${file.name}" — skipping.` });
      }
    };
    input.click();
  });
}
