/**
 * Scan lock: decides whether a camera frame may start a lookup.
 *
 * The camera keeps one stable `onBarcodeScanned` handler (see
 * `camera-frame-gate.ts`), so frames keep arriving while a lookup runs. This
 * lock is the only thing that stops a second frame from starting a second
 * lookup, and the cooldown memory (`lastScan`) stops the same code from being
 * looked up again right after it finished.
 *
 * Pure and React-free so Node's test runner can cover it. Both scanners
 * (`app/(tabs)/scanner.tsx`, `app/(tabs)/audits/scan.tsx`) call it in their
 * scan handler before the first `await`.
 *
 * @see {@link file://./scan-lock.test.ts}
 */

/** A mutable box, shaped like a React ref. */
type Box<T> = { current: T };

/**
 * Claims the lock for `code` if no lookup is running and `code` is not the
 * code still in cooldown.
 *
 * @param processing - True while a lookup runs; set to true on success.
 * @param lastScan - The code in cooldown ("" when none); set to `code` on
 *   success.
 * @param code - The scanned value.
 * @returns True when the caller may start a lookup; false when the frame must
 *   be dropped.
 */
export function tryBeginScan(
  processing: Box<boolean>,
  lastScan: Box<string>,
  code: string
): boolean {
  if (processing.current || code === lastScan.current) return false;
  processing.current = true;
  lastScan.current = code;
  return true;
}

/**
 * Releases the lock after a lookup ends. The cooldown memory is left alone:
 * the scanner's cooldown timer clears it.
 *
 * @param processing - The lock to release.
 */
export function endScan(processing: Box<boolean>): void {
  processing.current = false;
}
