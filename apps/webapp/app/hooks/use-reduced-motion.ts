/**
 * useReducedMotion re-export.
 *
 * Provides a canonical import path for components that need to respect the
 * user's `prefers-reduced-motion` system setting (WCAG 2.3.3). Re-exported
 * from framer-motion so we have one import path even if we later swap the
 * underlying motion library or extend the hook.
 *
 * @see {@link file://./../components/shared/animation-provider.tsx}
 */
export { useReducedMotion } from "framer-motion";
