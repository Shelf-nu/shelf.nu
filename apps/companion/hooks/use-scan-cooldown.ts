import { useCallback, useEffect, useRef } from "react";

const DEFAULT_COOLDOWN_MS = 3_000;

/**
 * Prevents the same QR / barcode from being processed again
 * within a short cooldown window.
 *
 * Usage:
 * ```ts
 * const { shouldSkip, startCooldown, lastScanRef } = useScanCooldown();
 *
 * function onScan(data: string) {
 *   if (shouldSkip(data)) return;
 *   lastScanRef.current = data;
 *   // ... process scan ...
 *   startCooldown();
 * }
 * ```
 */
export function useScanCooldown(cooldownMs = DEFAULT_COOLDOWN_MS) {
  const lastScanRef = useRef("");
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Returns `true` when the code should be ignored (duplicate). */
  const shouldSkip = useCallback(
    (code: string) => code === lastScanRef.current,
    []
  );

  /** Starts the cooldown timer; after it expires the same code can
   *  be scanned again. */
  const startCooldown = useCallback(() => {
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => {
      lastScanRef.current = "";
    }, cooldownMs);
  }, [cooldownMs]);

  /** Clears any pending cooldown timer. Call in cleanup effects. */
  const cleanup = useCallback(() => {
    if (cooldownRef.current) clearTimeout(cooldownRef.current);
  }, []);

  // Auto-cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  return { shouldSkip, startCooldown, cleanup, lastScanRef };
}
