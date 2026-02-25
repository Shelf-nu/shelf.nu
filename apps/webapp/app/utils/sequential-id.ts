const SEQUENTIAL_ID_REGEX = /^[A-Z]+-\d{4,}$/;

/**
 * Normalizes a sequential/SAM ID value by trimming and uppercasing it.
 */
export function normalizeSequentialId(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Checks if a value matches the sequential/SAM ID format (e.g., SAM-0001).
 */
export function isSequentialId(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalizedValue = normalizeSequentialId(value);
  return SEQUENTIAL_ID_REGEX.test(normalizedValue);
}

/**
 * Parses a value and returns the normalized sequential/SAM ID when valid.
 */
export function parseSequentialId(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  const normalizedValue = normalizeSequentialId(value);
  return SEQUENTIAL_ID_REGEX.test(normalizedValue) ? normalizedValue : null;
}
