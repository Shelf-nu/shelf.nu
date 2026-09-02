/**
 * numberInputWheelGuard — unit tests
 *
 * Verifies the contract of the wheel guard for `<input type="number">`:
 *  - A wheel event on a focused input is cancelled (the browser's step
 *    behaviour is suppressed).
 *  - A wheel event on an unfocused input is left alone so the page scrolls.
 *  - Read-only inputs never step, so their wheel events are left alone.
 *  - Focus handlers supplied by the caller keep running.
 *
 * @see {@link file://./number-input-wheel-guard.ts}
 */

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  numberInputWheelGuard,
  withNumberInputWheelGuard,
} from "./number-input-wheel-guard";

function dispatchWheel(target: Element) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("numberInputWheelGuard", () => {
  it("cancels wheel events only while the input is focused", () => {
    const { getByLabelText } = render(
      <input type="number" aria-label="Quantity" {...numberInputWheelGuard} />
    );
    const input = getByLabelText("Quantity");

    expect(dispatchWheel(input)).toBe(false);

    fireEvent.focus(input);
    expect(dispatchWheel(input)).toBe(true);

    fireEvent.blur(input);
    expect(dispatchWheel(input)).toBe(false);
  });

  it("leaves read-only inputs alone", () => {
    const { getByLabelText } = render(
      <input
        type="number"
        aria-label="Quantity"
        readOnly
        {...numberInputWheelGuard}
      />
    );
    const input = getByLabelText("Quantity");

    fireEvent.focus(input);
    expect(dispatchWheel(input)).toBe(false);
  });

  it("survives repeated focus without stacking listeners", () => {
    const { getByLabelText } = render(
      <input type="number" aria-label="Quantity" {...numberInputWheelGuard} />
    );
    const input = getByLabelText("Quantity");

    fireEvent.focus(input);
    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(dispatchWheel(input)).toBe(false);
  });
});

describe("withNumberInputWheelGuard", () => {
  it("keeps the caller's focus handlers and still guards the wheel", () => {
    // why: spies prove the caller's own focus handlers still run after the guard wraps them
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const { getByLabelText } = render(
      <input
        type="number"
        aria-label="Quantity"
        {...withNumberInputWheelGuard<HTMLInputElement>({ onFocus, onBlur })}
      />
    );
    const input = getByLabelText("Quantity");

    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(dispatchWheel(input)).toBe(true);

    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(dispatchWheel(input)).toBe(false);
  });
});
