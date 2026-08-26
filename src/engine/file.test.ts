import { describe, it, expect } from "vitest";
import { serializeFile, deserializeFile, migrateFile, CURRENT_FILE_VERSION } from "./file";
import type { FileFormat } from "./file";
import { createSheet, setCellRaw, setCellFormat } from "./evaluate";
import { DEFAULT_NUM_SAMPLES, DEFAULT_CHAIN_SEARCH_LIMIT } from "../constants";

const SETTINGS = { numSamples: DEFAULT_NUM_SAMPLES, chainSearchLimit: DEFAULT_CHAIN_SEARCH_LIMIT };

describe("file format v3: cell formats", () => {
  it("round-trips formats through serialize/deserialize", () => {
    const sheet = createSheet();
    setCellRaw(sheet, "A1", "0.5");
    setCellRaw(sheet, "A2", "10.2");
    setCellFormat(sheet, "A1", { formatString: "{%}" });
    setCellFormat(sheet, "A2", { formatString: "{.2} €", sigFigs: 4, bold: true });

    const data = serializeFile([sheet], "test", SETTINGS);
    expect(data.version).toBe(CURRENT_FILE_VERSION);
    expect(data.sheets[0].formats).toEqual({
      A1: { formatString: "{%}" },
      A2: { formatString: "{.2} €", sigFigs: 4, bold: true },
    });

    const { sheets } = deserializeFile(data);
    expect(sheets[0].cells.get("A1")?.format).toEqual({ formatString: "{%}" });
    expect(sheets[0].cells.get("A2")?.format).toEqual({ formatString: "{.2} €", sigFigs: 4, bold: true });
  });

  it("omits the formats key when nothing is formatted", () => {
    const sheet = createSheet();
    setCellRaw(sheet, "A1", "5");
    const data = serializeFile([sheet], "test", SETTINGS);
    expect("formats" in data.sheets[0]).toBe(false);
  });

  it("migrates v2 files transparently", () => {
    const v2: FileFormat = {
      version: 2,
      name: "old",
      sheets: [{ name: "Sheet 1", cells: { A1: "5", B1: "=A1*2" } }],
    };
    const { name, sheets } = deserializeFile(v2);
    expect(name).toBe("old");
    expect(sheets[0].cells.get("B1")?.result).toEqual({ kind: "scalar", value: 10 });
    expect(sheets[0].cells.get("A1")?.format).toBeUndefined();
  });

  it("rejects files newer than this build", () => {
    const v99 = { version: 99, sheets: [] } as unknown as FileFormat;
    expect(() => migrateFile(v99)).toThrow(/newer version/);
  });

  it("rejects files of unknown vintage or shape", () => {
    expect(() => migrateFile({ version: 1, sheets: [] } as unknown as FileFormat)).toThrow(/unsupported/);
    expect(() => migrateFile({ foo: "bar" } as unknown as FileFormat)).toThrow(/not a valid/);
  });
});

describe("view state: active sheet and cell", () => {
  it("round-trips the active sheet and cell", () => {
    const sheets = [createSheet("One"), createSheet("Two")];
    const data = serializeFile(sheets, "test", SETTINGS, { activeSheet: 1, activeCell: "C7" });
    expect(data.activeSheet).toBe(1);
    expect(data.activeCell).toBe("C7");

    const { view } = deserializeFile(data);
    expect(view).toEqual({ activeSheet: 1, activeCell: "C7" });
  });

  it("omits default view state (first sheet, no selection)", () => {
    const data = serializeFile([createSheet()], "test", SETTINGS, { activeSheet: 0, activeCell: null });
    expect("activeSheet" in data).toBe(false);
    expect("activeCell" in data).toBe(false);
  });

  it("defaults view state for files without it", () => {
    const { view } = deserializeFile(serializeFile([createSheet()], "test", SETTINGS));
    expect(view).toEqual({ activeSheet: 0, activeCell: null });
  });

  it("falls back to defaults on invalid view state", () => {
    const data: FileFormat = {
      version: CURRENT_FILE_VERSION,
      sheets: [{ name: "Only", cells: {} }],
      activeSheet: 5, // out of range
      activeCell: "not-an-address",
    };
    const { view } = deserializeFile(data);
    expect(view).toEqual({ activeSheet: 0, activeCell: null });
  });

  it("does not write an out-of-range active sheet", () => {
    const data = serializeFile([createSheet()], "test", SETTINGS, { activeSheet: 3, activeCell: null });
    expect("activeSheet" in data).toBe(false);
  });
});
