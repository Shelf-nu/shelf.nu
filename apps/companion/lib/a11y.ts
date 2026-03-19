/**
 * Shared accessibility utilities for WCAG 2.1 AA compliance.
 *
 * Centralizes screen-reader announcements, reduced-motion detection,
 * focus management, and label helpers used across all screens.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo, findNodeHandle } from "react-native";

// ─── Announcements ───────────────────────────────────────────────────────────

/**
 * Announce a message to screen readers (VoiceOver / TalkBack).
 * Use for dynamic status changes: scan results, list loads, action confirmations.
 */
export function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

// ─── Reduced Motion ──────────────────────────────────────────────────────────

/**
 * Hook that returns `true` when the user has enabled "Reduce Motion"
 * in their OS accessibility settings. Use to skip non-essential animations.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => subscription.remove();
  }, []);

  return reduceMotion;
}

// ─── Focus Management ────────────────────────────────────────────────────────

/**
 * Hook that sets screen-reader focus to the given ref after a short delay.
 * Useful after deep-link navigation to guide users to the primary content.
 */
export function useAccessibilityAutoFocus(
  ref: React.RefObject<any>,
  delay = 500
) {
  useEffect(() => {
    const timer = setTimeout(() => {
      const node = ref.current ? findNodeHandle(ref.current) : null;
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [ref, delay]);
}

// ─── Label Helpers ───────────────────────────────────────────────────────────

/**
 * Append ", required" to a field label for screen readers.
 * E.g. `labelForRequired("Title")` → `"Title, required"`
 */
export function labelForRequired(label: string): string {
  return `${label}, required`;
}
