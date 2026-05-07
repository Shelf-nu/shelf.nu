import type { RefObject } from "react";
import { useEffect, useRef } from "react";

/**
 * Imperatively focus an element after mount or when a condition becomes true.
 *
 * Replaces the `autoFocus` JSX prop (which `jsx-a11y/no-autofocus` disallows)
 * without regressing UX. Defers focus to the next animation frame by default
 * so the element is in the DOM even when rendered inside a Radix portal that
 * mounts on the next tick.
 *
 * @example
 * // Focus on mount (default):
 * const ref = useAutoFocus<HTMLInputElement>();
 * return <Input ref={ref} />;
 *
 * @example
 * // Focus when a dialog opens (re-focuses each time `open` flips to true):
 * const ref = useAutoFocus<HTMLInputElement>({ when: open });
 *
 * @example
 * // Skip the rAF defer when the element is guaranteed in DOM at effect time:
 * const ref = useAutoFocus<HTMLInputElement>({ deferToNextFrame: false });
 */
export function useAutoFocus<T extends HTMLElement>(
  options: {
    /** Focus only while this is true. Defaults to `true` (focus on mount). */
    when?: boolean;
    /**
     * Defer the focus call to the next animation frame so portal-mounted
     * elements (Radix popover/dialog content) have time to attach. Defaults
     * to `true`.
     */
    deferToNextFrame?: boolean;
  } = {}
): RefObject<T | null> {
  const { when = true, deferToNextFrame = true } = options;
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!when) return;

    if (!deferToNextFrame) {
      ref.current?.focus();
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      ref.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [when, deferToNextFrame]);

  return ref;
}
