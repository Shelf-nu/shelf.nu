import { useCallback, useEffect, useRef } from "react";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Auto-pauses the camera after a period of inactivity.
 *
 * The timer starts when the screen is focused and not paused,
 * and resets on every scan or resume. When it fires it calls
 * `onTimeout` (typically `setIsPaused(true)`).
 *
 * @returns `resetTimer` — call this after every successful scan
 *   to restart the countdown.
 */
export function useInactivityTimer(options: {
  isFocused: boolean;
  isPaused: boolean;
  timeoutMs?: number;
  onTimeout: () => void;
  /** Extra conditions that must all be `true` to run the timer
   *  (e.g. `!isInitializing`). */
  extraConditions?: boolean[];
}): { resetTimer: () => void } {
  const {
    isFocused,
    isPaused,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onTimeout,
    extraConditions = [],
  } = options;

  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(onTimeout, timeoutMs);
  }, [onTimeout, timeoutMs]);

  const shouldRun = isFocused && !isPaused && extraConditions.every(Boolean);

  useEffect(() => {
    if (shouldRun) {
      resetTimer();
    }
    return () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, [shouldRun, resetTimer]);

  return { resetTimer };
}
