import { BarcodeType } from "@prisma/client";
import { validateBarcodeValue } from "./validation";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

describe("EAN-13 barcode validation", () => {
  it("should validate correct EAN-13 barcode", () => {
    // This is a valid ISBN-13 (EAN-13 format)
    const result = validateBarcodeValue(BarcodeType.EAN13, "9780201379624");
    expect(result).toBeNull();
  });

  it("should validate other correct EAN-13 barcode", () => {
    // Another valid EAN-13 (check digit 8)
    const result = validateBarcodeValue(BarcodeType.EAN13, "1234567890128");
    expect(result).toBeNull();
  });

  it("should reject EAN-13 with invalid check digit", () => {
    const result = validateBarcodeValue(BarcodeType.EAN13, "1234567890123");
    expect(result).toContain("invalid check digit");
  });

  it("should reject too short EAN-13 barcode", () => {
    const result = validateBarcodeValue(BarcodeType.EAN13, "123456789012");
    expect(result).toContain("exactly 13 digits");
  });

  it("should reject too long EAN-13 barcode", () => {
    const result = validateBarcodeValue(BarcodeType.EAN13, "12345678901234");
    expect(result).toContain("exactly 13 digits");
  });

  it("should reject non-numeric EAN-13 barcode", () => {
    const result = validateBarcodeValue(BarcodeType.EAN13, "123456789012A");
    expect(result).toContain("only numeric digits");
  });

  it("should reject empty EAN-13 barcode", () => {
    const result = validateBarcodeValue(BarcodeType.EAN13, "");
    expect(result).toContain("required");
  });

  it("should reject EAN-13 with special characters", () => {
    const result = validateBarcodeValue(BarcodeType.EAN13, "1234567890-23");
    expect(result).toContain("only numeric digits");
  });

  it("should reject EAN-13 with spaces", () => {
    const result = validateBarcodeValue(BarcodeType.EAN13, "1234567890 23");
    expect(result).toContain("only numeric digits");
  });
});