import { useCallback } from "react";

/**
 * Triggers haptic feedback on mobile devices via the Vibration API.
 *
 * Works on Android Chrome and other browsers that support navigator.vibrate().
 * iOS Safari does not support the Vibration API and has no alternative that
 * works without a direct user gesture, so haptics gracefully degrade to a
 * no-op on iOS.
 */

const VIBRATE_SUPPORTED =
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export function useHapticFeedback() {
  const triggerSuccess = useCallback(() => {
    if (VIBRATE_SUPPORTED) {
      navigator.vibrate([50, 50, 50]);
    }
  }, []);

  const triggerError = useCallback(() => {
    if (VIBRATE_SUPPORTED) {
      navigator.vibrate([40, 40, 40, 40, 40]);
    }
  }, []);

  return { triggerSuccess, triggerError };
}
