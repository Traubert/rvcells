import type { Sheet, CellAddress } from "./types";
import { parseCell } from "./parser";
import { recalculateAllBulk, createSheet } from "./evaluate";

/** On-disk format */
export interface FileFormat {
  version: number;
  name?: string; // v1 compat: workbook-level name
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
      numSamples: sheets[0]?.numSamples ?? 10_000,
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
  const numSamples = file.settings?.numSamples ?? 10_000;
  const fileName = file.name || "Untitled file";

  if (!file.sheets?.length) {
    return { name: fileName, sheets: [createSheet(numSamples)] };
  }

  // Deduplicate sheet names: first occurrence keeps its name, duplicates get renamed
  const usedNames = new Set<string>();
  let nextNum = 1;
  const sheets = file.sheets.map((sheetData) => {
    let name = sheetData.name || "Untitled sheet";
    if (usedNames.has(name)) {
      // Find a unique name
      while (usedNames.has(`Untitled sheet ${nextNum}`)) nextNum++;
      name = `Untitled sheet ${nextNum}`;
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

/** Open a file picker and load sheets. Returns null if user cancels. */
export function openFromFile(): Promise<{ name: string; sheets: Sheet[] } | null> {
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
        if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.sheets)) {
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
