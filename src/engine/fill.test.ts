import { describe, it, expect } from "vitest";
import { shiftCellText } from "./fill";

describe("shiftCellText", () => {
  describe("basic shifting", () => {
    it("shifts row references down", () => {
      expect(shiftCellText("= A1 + B1", 0, 1)).toBe("= A2 + B2");
    });

    it("shifts column references right", () => {
      expect(shiftCellText("= A1 + A2", 1, 0)).toBe("= B1 + B2");
    });

    it("shifts both row and column", () => {
      expect(shiftCellText("= A1", 2, 3)).toBe("= C4");
    });

    it("shifts multiple references independently", () => {
      expect(shiftCellText("= A1 + B2 * C3", 1, 1)).toBe("= B2 + C3 * D4");
    });
  });

  describe("pinned references ($)", () => {
    it("does not shift pinned column", () => {
      expect(shiftCellText("= $A1", 1, 0)).toBe("= $A1");
    });

    it("does not shift pinned row", () => {
      expect(shiftCellText("= A$1", 0, 1)).toBe("= A$1");
    });

    it("does not shift fully pinned reference", () => {
      expect(shiftCellText("= $A$1", 3, 3)).toBe("= $A$1");
    });

    it("shifts unpinned axis of partially pinned ref", () => {
      expect(shiftCellText("= $A1", 0, 2)).toBe("= $A3");
      expect(shiftCellText("= A$1", 2, 0)).toBe("= C$1");
    });

    it("handles mix of pinned and unpinned", () => {
      expect(shiftCellText("= $A1 + B$2", 1, 1)).toBe("= $A2 + C$2");
    });
  });

  describe("variable assignments", () => {
    it("shifts refs in variable assignment formulas", () => {
      expect(shiftCellText("total = A1 + B1", 0, 1)).toBe("total = A2 + B2");
    });
  });

  describe(":= syntax", () => {
    it("shifts refs in := formulas", () => {
      expect(shiftCellText(":= A1 + B1", 0, 1)).toBe(":= A2 + B2");
    });
  });

  describe("non-formula cells", () => {
    it("returns plain numbers unchanged", () => {
      expect(shiftCellText("42", 1, 1)).toBe("42");
    });

    it("returns text unchanged", () => {
      expect(shiftCellText("hello", 1, 1)).toBe("hello");
    });

    it("returns distributions unchanged", () => {
      expect(shiftCellText("Normal(100, 10)", 1, 1)).toBe("Normal(100, 10)");
    });
  });

  describe("edge cases", () => {
    it("does not shift past column 0", () => {
      expect(shiftCellText("= A1", -1, 0)).toBe("= A1");
    });

    it("does not shift past row 0", () => {
      expect(shiftCellText("= A1", 0, -1)).toBe("= A1");
    });
  });
});
