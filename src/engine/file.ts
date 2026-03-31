import type { Sheet, CellAddress } from "./types";
import { parseCell } from "./parser";
import { recalculateAllBulk, createSheet } from "./evaluate";
import { DEFAULT_WORKBOOK_NAME, DEFAULT_SHEET_NAME, DEFAULT_NUM_SAMPLES } from "../constants";

/** On-disk format */
export interface FileFormat {
  version: number;
  name?: string;
  settings: {
    numSamples: number;
  };
  sheets: Array<{
    name: string;
    cells: Record<string, string>; // addr → raw text
  }>;
}

/** Serialize multiple sheets to a saveable JSON object */
export function serializeFile(sheets: Sheet[], name: string): FileFormat {
  return {
    version: 2,
    name,
    settings: {
      numSamples: sheets[0]?.numSamples ?? DEFAULT_NUM_SAMPLES,
    },
    sheets: sheets.map((sheet) => {
      const cells: Record<string, string> = {};
      for (const [addr, cell] of sheet.cells) {
        cells[addr] = cell.raw;
      }
      return { name: sheet.name, cells };
    }),
  };
}

/** Deserialize a file into a name and array of sheets. */
export function deserializeFile(file: FileFormat): { name: string; sheets: Sheet[] } {
  const numSamples = file.settings?.numSamples ?? DEFAULT_NUM_SAMPLES;
  const fileName = file.name || DEFAULT_WORKBOOK_NAME;

  if (!file.sheets?.length) {
    return { name: fileName, sheets: [createSheet(numSamples)] };
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
    const sheet = createSheet(numSamples, name);

    for (const [addr, raw] of Object.entries(sheetData.cells)) {
      const { content, variableName, labelVar } = parseCell(raw);
      sheet.cells.set(addr as CellAddress, { raw, content, variableName, labelVar });
    }

    return sheet;
  });

  // Bulk recalculate all sheets together for cross-sheet references
  recalculateAllBulk(sheets);

  return { name: fileName, sheets };
}

/** Save sheets as a JSON file download */
export function saveToFile(sheets: Sheet[], name: string): void {
  const data = serializeFile(sheets, name);
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
export function openFromFile(): Promise<{ name: string; sheets: Sheet[] } | { error: string } | null> {
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
