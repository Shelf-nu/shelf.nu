/**
 * SAM / sequential ID helpers.
 *
 * Mirrors the webapp util (`apps/webapp/app/utils/sequential-id.ts`) so the
 * mobile scanner classifies and normalizes SAM ids identically to the web
 * scan resolver. A SAM id looks like `SAM-0001`: one or more letters, a
 * hyphen, then four or more digits (after trim + uppercase).
 *
 * @see {@link file://./../../webapp/app/utils/sequential-id.ts} source of truth
 */

const SEQUENTIAL_ID_REGEX = /^[A-Z]+-\d{4,}$/;

/** Trims and uppercases a SAM/sequential id for comparison. */
export function normalizeSequentialId(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Parses a scanned value and returns the normalized SAM id when it matches the
 * format, or `null` otherwise.
 *
 * @param value - Raw scanned/typed string (may be null/undefined).
 * @returns The normalized SAM id (e.g. `SAM-0001`) or `null`.
 */
export function parseSequentialId(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeSequentialId(value);
  return SEQUENTIAL_ID_REGEX.test(normalized) ? normalized : null;
}
