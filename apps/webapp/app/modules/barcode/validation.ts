import { BarcodeType } from "@prisma/client";
import { z } from "zod";

// Barcode length constants for easy maintenance
export const BARCODE_LENGTHS = {
  CODE128_MIN: 4,
  CODE128_MAX: 40,
  CODE128_WARN_THRESHOLD: 30,
  CODE39_MIN: 4,
  CODE39_MAX: 43,
  DATAMATRIX_MIN: 4,
  DATAMATRIX_MAX: 100,
  EXTERNAL_QR_MIN: 1,
  EXTERNAL_QR_MAX: 2048,
  EAN13_LENGTH: 13,
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
 * Asset management optimized: 4-43 characters
 */
const validateCode39 = (value: string) => {
  if (!value || value.length === 0) {
    return "Barcode value is required";
  }

  if (value.length < BARCODE_LENGTHS.CODE39_MIN) {
    return `Code39 barcode must be at least ${BARCODE_LENGTHS.CODE39_MIN} characters`;
  }

  if (value.length > BARCODE_LENGTHS.CODE39_MAX) {
    return `Code39 barcode too long (max ${BARCODE_LENGTHS.CODE39_MAX} characters)`;
  }

  // Code39 alphanumeric: A-Z, 0-9 (industry standard for asset tracking)
  const alphanumericRegex = /^[A-Z0-9]*$/;
  if (!alphanumericRegex.test(value)) {
    return "Code39 barcode must contain only uppercase letters (A-Z) and numbers (0-9)";
  }

  return null;
};

/**
 * Validation rules for DataMatrix
 * Flexible 2D barcode: 4-100 characters for various use cases
 */
const validateDataMatrix = (value: string) => {
  if (!value || value.length === 0) {
    return "Barcode value is required";
  }

  if (value.length < BARCODE_LENGTHS.DATAMATRIX_MIN) {
    return `DataMatrix barcode must be at least ${BARCODE_LENGTHS.DATAMATRIX_MIN} characters`;
  }

  if (value.length > BARCODE_LENGTHS.DATAMATRIX_MAX) {
    return `DataMatrix barcode too long (max ${BARCODE_LENGTHS.DATAMATRIX_MAX} characters)`;
  }

  // Check for valid ASCII printable characters (same as Code128 for flexibility)
  const validAsciiRegex = /^[\x20-\x7E]*$/;
  if (!validAsciiRegex.test(value)) {
    return "DataMatrix barcode contains invalid characters";
  }

  return null;
};

/**
 * Validation rules for External QR codes
 * Flexible validation for URLs, text, structured data
 */
const validateExternalQR = (value: string) => {
  if (!value || value.trim().length === 0) {
    return "External QR data is required";
  }

  if (value.length < BARCODE_LENGTHS.EXTERNAL_QR_MIN) {
    return `External QR data must be at least ${BARCODE_LENGTHS.EXTERNAL_QR_MIN} character`;
  }

  if (value.length > BARCODE_LENGTHS.EXTERNAL_QR_MAX) {
    return `External QR data too long (max ${BARCODE_LENGTHS.EXTERNAL_QR_MAX} characters)`;
  }

  // Allow any UTF-8 content (URLs, text, structured data, etc.)
  // No character restrictions for maximum flexibility
  return null;
};

/**
 * Validation rules for EAN-13 barcodes
 * International product identification: exactly 13 numeric digits with check digit validation
 */
const validateEAN13 = (value: string) => {
  if (!value || value.length === 0) {
    return "EAN-13 barcode value is required";
  }

  if (value.length !== BARCODE_LENGTHS.EAN13_LENGTH) {
    return `EAN-13 barcode must be exactly ${BARCODE_LENGTHS.EAN13_LENGTH} digits`;
  }

  // Check if all characters are numeric
  const numericRegex = /^[0-9]*$/;
  if (!numericRegex.test(value)) {
    return "EAN-13 barcode must contain only numeric digits (0-9)";
  }

  // Validate EAN-13 check digit
  const digits = value.split("").map(Number);
  const checkDigit = digits[12];
  const calculatedCheckDigit = calculateEAN13CheckDigit(value.substring(0, 12));

  if (checkDigit !== calculatedCheckDigit) {
    return "EAN-13 barcode has an invalid check digit";
  }

  return null;
};

/**
 * Calculate EAN-13 check digit using the standard algorithm
 */
function calculateEAN13CheckDigit(first12Digits: string): number {
  const digits = first12Digits.split("").map(Number);
  let sum = 0;

  for (let i = 0; i < 12; i++) {
    // Multiply odd positioned digits (1st, 3rd, 5th, etc.) by 1
    // Multiply even positioned digits (2nd, 4th, 6th, etc.) by 3
    const multiplier = i % 2 === 0 ? 1 : 3;
    sum += digits[i] * multiplier;
  }

  // Check digit is the amount needed to reach the next multiple of 10
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Normalizes a barcode value based on its type
 * ExternalQR preserves original case, others are converted to uppercase
 */
export function normalizeBarcodeValue(
  type: BarcodeType,
  value: string
): string {
  switch (type) {
    case BarcodeType.ExternalQR:
      return value; // Preserve original case for URLs and flexible content
    case BarcodeType.Code128:
    case BarcodeType.Code39:
    case BarcodeType.DataMatrix:
    case BarcodeType.EAN13:
      return value.toUpperCase(); // Convert to uppercase for consistency
    default:
      return value.toUpperCase(); // Default to uppercase
  }
}

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
    case BarcodeType.DataMatrix:
      return validateDataMatrix(value);
    case BarcodeType.ExternalQR:
      return validateExternalQR(value);
    case BarcodeType.EAN13:
      return validateEAN13(value);
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
