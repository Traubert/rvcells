import type { Sheet, CellAddress } from "./types";
import { parseCell } from "./parser";
import { recalculateBulk, createSheet } from "./evaluate";

/** On-disk format */
export interface FileFormat {
  version: number;
  name: string;
  settings: {
    numSamples: number;
  };
  sheets: Array<{
    name: string;
    cells: Record<string, string>; // addr → raw text
  }>;
}

/** Serialize a sheet to a saveable JSON object */
export function serializeFile(sheet: Sheet): FileFormat {
  const cells: Record<string, string> = {};
  for (const [addr, cell] of sheet.cells) {
    cells[addr] = cell.raw;
  }
  return {
    version: 1,
    name: sheet.name,
    settings: {
      numSamples: sheet.numSamples,
    },
    sheets: [{ name: "Sheet 1", cells }],
  };
}

/** Deserialize a file into a sheet. Parses all cells and runs bulk recalculation
 *  (with cycle detection that marks all cycle participants). */
export function deserializeFile(file: FileFormat): Sheet {
  const sheetData = file.sheets[0];
  if (!sheetData) return createSheet(file.settings?.numSamples ?? 10_000, file.name ?? "Untitled table");

  const sheet = createSheet(file.settings?.numSamples ?? 10_000, file.name ?? "Untitled table");

  // Parse all cells
  for (const [addr, raw] of Object.entries(sheetData.cells)) {
    const { content, variableName } = parseCell(raw);
    sheet.cells.set(addr as CellAddress, { raw, content, variableName });
  }

  // Bulk recalculate with cycle detection
  recalculateBulk(sheet);

  return sheet;
}

/** Save a sheet as a JSON file download */
export function saveToFile(sheet: Sheet): void {
  const data = serializeFile(sheet);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sheet.name + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a file picker and load a sheet. Returns null if user cancels. */
export function openFromFile(): Promise<Sheet | null> {
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
        if (data.version !== 1 || !Array.isArray(data.sheets)) {
          throw new Error("Invalid file format");
        }
        resolve(deserializeFile(data));
      } catch (e) {
        alert(`Failed to load file: ${(e as Error).message}`);
        resolve(null);
      }
    };
    input.click();
  });
}
