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

  // @TODO - temporary disabled number check due to bug and corrupted ids
  // /**
  //  * 1. The string must contain only lowercase letters and digits.
  //  * 2. The string must start with a lowercase letter.
  //  * 3. The string must contain at least one digit.
  //  */
  // const regex = /^(?=.*\d)[a-z][0-9a-z]*$/;

  /**
   * Adjusted criteria:
   * 1. The string must contain only lowercase letters.
   * 2. The string must start with a lowercase letter.
   */
  const regex = /^[a-z][0-9a-z]*$/;

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
