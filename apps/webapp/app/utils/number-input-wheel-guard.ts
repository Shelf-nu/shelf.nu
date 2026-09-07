/**
 * Keeps the mouse wheel from stepping a focused `<input type="number">`.
 *
 * Chromium-based browsers change the value of a focused number input on every
 * wheel tick while the pointer rests on it, so scrolling past a field rewrites
 * it. Cancelling the wheel event stops that. React registers `wheel` as a
 * passive listener, which turns `preventDefault` inside `onWheel` into a no-op,
 * so the guard attaches its own non-passive listener while the input has focus
 * and removes it on blur. Typing, paste, arrow keys and the spin buttons keep
 * working, the wheel scrolls the page again as soon as focus leaves, and
 * read-only inputs (which never step) are left alone.
 *
 * @see {@link file://../components/forms/input.tsx} applies the guard to every
 * shared input with `type="number"`; plain inputs spread `numberInputWheelGuard`.
 */
import type { FocusEvent, FocusEventHandler } from "react";

type FocusHandlers<T extends HTMLElement> = {
  onFocus?: FocusEventHandler<T>;
  onBlur?: FocusEventHandler<T>;
};

function cancelWheelStep(event: WheelEvent) {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement && input.readOnly) return;
  event.preventDefault();
}

/**
 * Wraps a component's focus handlers so the wheel guard runs alongside them.
 * Use it when the input already receives `onFocus` / `onBlur` props.
 *
 * @param handlers - The caller's own `onFocus` / `onBlur`, if any; each runs
 * after the guard's listener is attached or removed
 * @returns Both focus handlers, ready to spread onto the element
 */
export function withNumberInputWheelGuard<T extends HTMLElement>({
  onFocus,
  onBlur,
}: FocusHandlers<T>): Required<FocusHandlers<T>> {
  return {
    onFocus(event: FocusEvent<T>) {
      event.currentTarget.addEventListener("wheel", cancelWheelStep, {
        passive: false,
      });
      onFocus?.(event);
    },
    onBlur(event: FocusEvent<T>) {
      event.currentTarget.removeEventListener("wheel", cancelWheelStep);
      onBlur?.(event);
    },
  };
}

/** Focus handlers to spread onto a plain `<input type="number">`. */
export const numberInputWheelGuard =
  withNumberInputWheelGuard<HTMLInputElement>({});
