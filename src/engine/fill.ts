import { toAddress } from "./types";
import { ID_START_SRC, ID_CONT_SRC } from "../constants";

/**
 * Shift cell references in a raw cell string by (dCol, dRow).
 * Pinned references ($A or $1) are not shifted on that axis.
 * Variable references (plain identifiers) are not shifted.
 *
 * Works on the raw text to preserve user formatting.
 */
export function shiftCellText(raw: string, dCol: number, dRow: number): string {
  // Match cell references in formulas: optional $ + uppercase letters + optional $ + digits
  // We need to handle this in the formula part of the cell text.
  // The formula part starts after "=" or ":=" or "varname ="

  const trimmed = raw.trim();

  // Find where the expression starts
  let prefix = "";
  let expr = trimmed;

  if (trimmed.startsWith(":=")) {
    prefix = trimmed.slice(0, trimmed.indexOf(":=") + 2);
    expr = trimmed.slice(prefix.length);
  } else if (trimmed.startsWith("=")) {
    prefix = "=";
    expr = trimmed.slice(1);
  } else {
    // Check for "name = ..." pattern
    const varMatch = trimmed.match(new RegExp(`^(${ID_START_SRC}${ID_CONT_SRC}*\\s*:?=\\s*)`, "u"));
    if (varMatch) {
      prefix = varMatch[1];
      expr = trimmed.slice(prefix.length);
    } else {
      // Not a formula — no references to shift (could be a distribution or number)
      // Still try to shift cell refs in case it's a distribution in a formula context
      // Actually, plain numbers/distributions/text have no cell refs, so return as-is
      return raw;
    }
  }

  // Replace cell references in the expression part
  const shifted = expr.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/g,
    (_match, dollarCol: string, colStr: string, dollarRow: string, rowStr: string) => {
      const pinCol = dollarCol === "$";
      const pinRow = dollarRow === "$";

      // Parse current col
      let col = 0;
      for (const ch of colStr) {
        col = col * 26 + (ch.charCodeAt(0) - 64);
      }
      col -= 1; // to 0-indexed

      const row = parseInt(rowStr, 10) - 1; // to 0-indexed

      // Apply shifts
      const newCol = pinCol ? col : col + dCol;
      const newRow = pinRow ? row : row + dRow;

      // Bounds check
      if (newCol < 0 || newRow < 0) return _match; // can't shift past origin, keep original

      // Rebuild the reference
      const newAddr = toAddress(newCol, newRow);
      // Re-parse the address to get col letters and row number
      const addrMatch = newAddr.match(/^([A-Z]+)(\d+)$/);
      if (!addrMatch) return _match;

      return (pinCol ? "$" : "") + addrMatch[1] + (pinRow ? "$" : "") + addrMatch[2];
    }
  );

  return prefix + shifted;
}
