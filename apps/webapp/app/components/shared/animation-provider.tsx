import type { ReactNode } from "react";
import { LazyMotion, domMax } from "framer-motion";

/**
 * AnimationProvider
 *
 * Wraps the app with framer-motion's `LazyMotion` so any descendant can use
 * the smaller `m` primitive instead of the full `motion` component. We load
 * `domMax` features because the app uses drag-and-drop (`Reorder`) and
 * layout animations in addition to basic motion. Saves bundle size while
 * still supporting every framer-motion feature we use today.
 *
 * Not `strict` — existing `motion.*` usage continues to work during the
 * incremental migration to `m.*`.
 *
 * @see https://www.framer.com/motion/lazy-motion/
 */
export function AnimationProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domMax}>{children}</LazyMotion>;
}
