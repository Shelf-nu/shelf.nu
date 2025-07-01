import { BarcodeType } from "@prisma/client";
import { z } from "zod";

// Barcode length constants for easy maintenance
export const BARCODE_LENGTHS = {
  CODE128_MIN: 4,
  CODE128_MAX: 40,
  CODE128_WARN_THRESHOLD: 30,
  CODE39_LENGTH: 6,
  MICRO_QR_LENGTH: 4,
} as const;

/**
 * Validation rules for Code128 barcodes
 * Practical length: 4-40 characters, warn at 30+
 */
const validateCode128 = (value: string) => {
  if (!value || value.length === 0) {
    return "Barcode value is required";
  }

  if (value.length < BARCODE_LENGTHS.CODE128_MIN) {
    return `Code128 barcode must be at least ${BARCODE_LENGTHS.CODE128_MIN} characters`;
  }

  if (value.length > BARCODE_LENGTHS.CODE128_MAX) {
    return `Code128 barcode too long (max ${BARCODE_LENGTHS.CODE128_MAX} characters)`;
  }

  // Check for valid ASCII printable characters
  const validAsciiRegex = /^[\x20-\x7E]*$/;
  if (!validAsciiRegex.test(value)) {
    return "Code128 barcode contains invalid characters";
  }

  return null;
};

/**
 * Validation rules for Code39 barcodes
 * Asset management optimized: exactly 6 characters
 */
const validateCode39 = (value: string) => {
  if (!value || value.length === 0) {
    return "Barcode value is required";
  }

  if (value.length !== BARCODE_LENGTHS.CODE39_LENGTH) {
    return `Code39 barcode must be exactly ${BARCODE_LENGTHS.CODE39_LENGTH} characters`;
  }

  // Code39 alphanumeric: A-Z, 0-9 (industry standard for asset tracking)
  const alphanumericRegex = /^[A-Z0-9]*$/;
  if (!alphanumericRegex.test(value)) {
    return "Code39 barcode must contain only uppercase letters (A-Z) and numbers (0-9)";
  }

  return null;
};

/**
 * Validation rules for MicroQRCode
 * Ultra-compact: exactly 4 characters for tiny printing
 */
const validateMicroQRCode = (value: string) => {
  if (!value || value.length === 0) {
    return "Barcode value is required";
  }

  if (value.length !== BARCODE_LENGTHS.MICRO_QR_LENGTH) {
    return `Micro QR Code must be exactly ${BARCODE_LENGTHS.MICRO_QR_LENGTH} characters`;
  }

  // Alphanumeric only for maximum compatibility and compactness
  const alphanumericRegex = /^[A-Z0-9]*$/;
  if (!alphanumericRegex.test(value)) {
    return "Micro QR Code must contain only uppercase letters (A-Z) and numbers (0-9)";
  }

  return null;
};

/**
 * Check if Code128 value should show warning (over 30 characters)
 */
export function shouldWarnLongBarcode(
  type: BarcodeType,
  value: string
): boolean {
  return (
    type === BarcodeType.Code128 &&
    value.length > BARCODE_LENGTHS.CODE128_WARN_THRESHOLD
  );
}

/**
 * Validates a barcode value based on its type
 */
export function validateBarcodeValue(
  type: BarcodeType,
  value: string
): string | null {
  switch (type) {
    case BarcodeType.Code128:
      return validateCode128(value);
    case BarcodeType.Code39:
      return validateCode39(value);
    case BarcodeType.MicroQRCode:
      return validateMicroQRCode(value);
    default:
      return "Unknown barcode type";
  }
}

/**
 * Zod schema for a single barcode
 */
export const BarcodeSchema = z
  .object({
    type: z.nativeEnum(BarcodeType),
    value: z.string().min(1, "Barcode value is required"),
  })
  .superRefine((data, ctx) => {
    const error = validateBarcodeValue(data.type, data.value);
    if (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error,
        path: ["value"],
      });
    }
  });

