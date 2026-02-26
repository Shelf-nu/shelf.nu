import { DEFAULT_CUID_LENGTH, LEGACY_CUID_LENGTH } from "../constants";

/**
 * Checks if a string is a valid QR id.
 *
 * QR id is a 10 character string
 * Legacy QR id is a 25 character string
 */
export function isQrId(id: string): boolean {
  const possibleLengths = [DEFAULT_CUID_LENGTH, LEGACY_CUID_LENGTH];
  const length = id.length;

  /**
   * The following conditions need to be met for the middleware to redirect to a QR code. In the rest of the cases, it just redirects to app root.
   * - The path should NOT include any special characters
   * - The path should start with a small letter
   * - The path should only have small letters and optional number
   * - The path's length should fit within the allowed character lengths(10 for new and 25 for legacy QR codes)
   */
  const regex = /^[a-z][a-z0-9]*$/;

  // Validate the ID against the criteria
  if (
    typeof id !== "string" ||
    !possibleLengths.includes(length) ||
    !regex.test(id)
  ) {
    return false;
  }

  return true;
}

export function hasNumber(str: string) {
  return /\d/.test(str);
}
