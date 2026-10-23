/**
 * Input — unit tests
 *
 * Verifies the shared form input:
 *  - A field with an `error` is marked `aria-invalid`, and an explicit
 *    caller value still wins.
 *
 * And its wheel guard wiring:
 *  - `type="number"` inputs ignore the wheel while focused and pass it through
 *    once focus leaves.
 *  - Other input types are untouched.
 *  - Caller-supplied focus handlers keep running on number inputs.
 *
 * @see {@link file://./input.tsx}
 */

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Input from "./input";

function dispatchWheel(target: Element) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("Input wheel guard", () => {
  it("cancels the wheel on a focused number input", () => {
    const { getByLabelText } = render(
      <Input label="Quantity" name="quantity" type="number" />
    );
    const input = getByLabelText("Quantity");

    expect(dispatchWheel(input)).toBe(false);
    fireEvent.focus(input);
    expect(dispatchWheel(input)).toBe(true);
    fireEvent.blur(input);
    expect(dispatchWheel(input)).toBe(false);
  });

  it("leaves text inputs alone", () => {
    const { getByLabelText } = render(
      <Input label="Name" name="name" type="text" />
    );
    const input = getByLabelText("Name");

    fireEvent.focus(input);
    expect(dispatchWheel(input)).toBe(false);
  });

  it("keeps caller focus handlers on number inputs", () => {
    // why: spies prove the caller's own focus handlers still run after Input wires the guard in
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const { getByLabelText } = render(
      <Input
        label="Quantity"
        name="quantity"
        type="number"
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
    const input = getByLabelText("Quantity");

    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe("Input invalid state", () => {
  it("marks an input with an error as invalid", () => {
    const { getByLabelText } = render(
      <Input label="Name" name="name" error="Name is required" />
    );
    expect(getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("marks a textarea with an error as invalid", () => {
    const { getByLabelText } = render(
      <Input label="Notes" name="notes" inputType="textarea" error="Too long" />
    );
    expect(getByLabelText("Notes")).toHaveAttribute("aria-invalid", "true");
  });

  it("leaves a valid input unmarked", () => {
    const { getByLabelText } = render(<Input label="Name" name="name" />);
    expect(getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps an explicit aria-invalid from the caller", () => {
    const { getByLabelText } = render(
      <Input
        label="Name"
        name="name"
        error="Name is required"
        aria-invalid={false}
      />
    );
    expect(getByLabelText("Name")).toHaveAttribute("aria-invalid", "false");
  });
});
