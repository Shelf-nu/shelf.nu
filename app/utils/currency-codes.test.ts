import { describe, expect, it } from "vitest";
import {
  CURRENCY_MAP,
  getCurrencyDecimalDigits,
  getCurrencyDefinition,
  getCurrencyName,
  ISO_4217_CURRENCIES,
  ISO_4217_CURRENCY_CODES,
  isValidCurrencyCode,
} from "./currency-codes";

describe("ISO 4217 Currency Codes", () => {
  describe("ISO_4217_CURRENCIES", () => {
    it("should have no duplicate currency codes", () => {
      const codes = ISO_4217_CURRENCIES.map((c) => c.code);
      const uniqueCodes = new Set(codes);
      expect(codes.length).toBe(uniqueCodes.size);
    });

    it("should have all codes in uppercase 3-letter format", () => {
      for (const currency of ISO_4217_CURRENCIES) {
        expect(currency.code).toMatch(/^[A-Z]{3}$/);
      }
    });

    it("should have valid numeric codes (3 digits)", () => {
      for (const currency of ISO_4217_CURRENCIES) {
        expect(currency.numericCode).toMatch(/^\d{3}$/);
      }
    });

    it("should have decimal digits between 0 and 3", () => {
      for (const currency of ISO_4217_CURRENCIES) {
        expect(currency.decimalDigits).toBeGreaterThanOrEqual(0);
        expect(currency.decimalDigits).toBeLessThanOrEqual(3);
      }
    });

    it("should be sorted alphabetically by code", () => {
      const sorted = [...ISO_4217_CURRENCIES].sort((a, b) =>
        a.code.localeCompare(b.code)
      );
      expect(ISO_4217_CURRENCIES.map((c) => c.code)).toEqual(
        sorted.map((c) => c.code)
      );
    });

    it("should include major world currencies", () => {
      const majorCurrencies = ["USD", "EUR", "GBP", "JPY", "CNY", "CHF", "CAD"];
      for (const code of majorCurrencies) {
        expect(
          ISO_4217_CURRENCIES.some((c) => c.code === code),
          `Expected ${code} to be in the list`
        ).toBe(true);
      }
    });

    it("should have at least 150 currencies (comprehensive ISO 4217 coverage)", () => {
      expect(ISO_4217_CURRENCIES.length).toBeGreaterThanOrEqual(150);
    });
  });

  describe("ISO_4217_CURRENCY_CODES", () => {
    it("should be an array of strings", () => {
      expect(Array.isArray(ISO_4217_CURRENCY_CODES)).toBe(true);
      for (const code of ISO_4217_CURRENCY_CODES) {
        expect(typeof code).toBe("string");
      }
    });

    it("should match the codes from ISO_4217_CURRENCIES", () => {
      const codes = ISO_4217_CURRENCIES.map((c) => c.code);
      expect(ISO_4217_CURRENCY_CODES).toEqual(codes);
    });
  });

  describe("CURRENCY_MAP", () => {
    it("should have the same number of entries as ISO_4217_CURRENCIES", () => {
      expect(CURRENCY_MAP.size).toBe(ISO_4217_CURRENCIES.length);
    });

    it("should allow lookup by currency code", () => {
      const usd = CURRENCY_MAP.get("USD");
      expect(usd).toBeDefined();
      expect(usd?.name).toBe("US Dollar");
      expect(usd?.numericCode).toBe("840");
      expect(usd?.decimalDigits).toBe(2);
    });
  });

  describe("getCurrencyDefinition", () => {
    it("should return currency definition for valid code", () => {
      const eur = getCurrencyDefinition("EUR");
      expect(eur).toBeDefined();
      expect(eur?.code).toBe("EUR");
      expect(eur?.name).toBe("Euro");
    });

    it("should return undefined for invalid code", () => {
      const invalid = getCurrencyDefinition("INVALID");
      expect(invalid).toBeUndefined();
    });
  });

  describe("getCurrencyName", () => {
    it("should return currency name for valid code", () => {
      expect(getCurrencyName("USD")).toBe("US Dollar");
      expect(getCurrencyName("JPY")).toBe("Yen");
      expect(getCurrencyName("GBP")).toBe("Pound Sterling");
    });

    it("should return code as fallback for invalid code", () => {
      expect(getCurrencyName("INVALID")).toBe("INVALID");
    });
  });

  describe("getCurrencyDecimalDigits", () => {
    it("should return correct decimal digits", () => {
      // Standard 2 decimal places
      expect(getCurrencyDecimalDigits("USD")).toBe(2);
      expect(getCurrencyDecimalDigits("EUR")).toBe(2);

      // Zero decimal places
      expect(getCurrencyDecimalDigits("JPY")).toBe(0);
      expect(getCurrencyDecimalDigits("KRW")).toBe(0);

      // Three decimal places
      expect(getCurrencyDecimalDigits("BHD")).toBe(3);
      expect(getCurrencyDecimalDigits("KWD")).toBe(3);
    });

    it("should return 2 as default for invalid code", () => {
      expect(getCurrencyDecimalDigits("INVALID")).toBe(2);
    });
  });

  describe("isValidCurrencyCode", () => {
    it("should return true for valid codes", () => {
      expect(isValidCurrencyCode("USD")).toBe(true);
      expect(isValidCurrencyCode("EUR")).toBe(true);
      expect(isValidCurrencyCode("JPY")).toBe(true);
    });

    it("should return false for invalid codes", () => {
      expect(isValidCurrencyCode("INVALID")).toBe(false);
      expect(isValidCurrencyCode("")).toBe(false);
      expect(isValidCurrencyCode("US")).toBe(false);
      expect(isValidCurrencyCode("usd")).toBe(false); // case sensitive
    });
  });
});
