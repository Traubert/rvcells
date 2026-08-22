import { describe, it, expect } from "vitest";
import { formatNumber, formatValue, parseFormatString, hasPlaceholder } from "./format";

describe("formatNumber sig figs", () => {
  it("defaults to 3 significant figures", () => {
    expect(formatNumber(1234.5)).toBe("1,230");
    expect(formatNumber(0.12345)).toBe("0.123");
  });

  it("respects a custom sig fig count", () => {
    expect(formatNumber(1234.5, 4)).toBe("1,235");
    expect(formatNumber(0.12345, 2)).toBe("0.12");
    expect(formatNumber(1234567, 4)).toBe("1.235M");
  });
});

describe("parseFormatString", () => {
  it("parses the three placeholder forms with affixes", () => {
    expect(parseFormatString("{}")).toEqual({ prefix: "", spec: { kind: "plain" }, suffix: "" });
    expect(parseFormatString("{%}")).toEqual({ prefix: "", spec: { kind: "percent" }, suffix: "" });
    expect(parseFormatString("{.2} €")).toEqual({ prefix: "", spec: { kind: "fixed", decimals: 2 }, suffix: " €" });
    expect(parseFormatString("~{} kg")).toEqual({ prefix: "~", spec: { kind: "plain" }, suffix: " kg" });
  });

  it("returns null without a placeholder", () => {
    expect(parseFormatString("just text")).toBeNull();
    expect(hasPlaceholder("just text")).toBe(false);
    expect(hasPlaceholder("{.10} €")).toBe(true);
  });
});

describe("formatValue", () => {
  it("plain placeholder and affixes", () => {
    expect(formatValue(1234.5, { formatString: "{} kg" })).toBe("1,230 kg");
    expect(formatValue(5, { formatString: "~{}" })).toBe("~5");
  });

  it("percent scales by 100", () => {
    expect(formatValue(0.5, { formatString: "{%}" })).toBe("50%");
    expect(formatValue(0.1234, { formatString: "{%}" })).toBe("12.3%");
    expect(formatValue(1.5, { formatString: "{%}" })).toBe("150%");
  });

  it("currency-style fixed decimals: pad when decimals survive sig-fig rounding", () => {
    const eur = { formatString: "{.2} €" };
    expect(formatValue(10.2, eur)).toBe("10.20 €");
    expect(formatValue(100.2, eur)).toBe("100 €");
    expect(formatValue(100.2, { ...eur, sigFigs: 4 })).toBe("100.20 €");
    expect(formatValue(0.5, eur)).toBe("0.50 €");
    expect(formatValue(0.123456, eur)).toBe("0.12 €");
    expect(formatValue(1234.5, eur)).toBe("1,230 €");
    expect(formatValue(1234.56, { ...eur, sigFigs: 6 })).toBe("1,234.56 €");
    expect(formatValue(0, eur)).toBe("0.00 €");
  });

  it("fixed decimals leave SI-suffix territory alone", () => {
    expect(formatValue(1234567, { formatString: "{.2} €" })).toBe("1.23M €");
  });

  it("sig figs apply without a format string", () => {
    expect(formatValue(1234.5, { sigFigs: 5 })).toBe("1,234.5");
    expect(formatValue(1234.5, undefined)).toBe("1,230");
  });
});
