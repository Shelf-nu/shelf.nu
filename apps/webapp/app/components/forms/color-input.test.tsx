/**
 * ColorInput unit tests.
 *
 * Pins that the swatch (the browser's native color picker) and the hex text
 * field stay in step in both directions, that only the hex field is submitted
 * with the form, and that focusing the hex field opens the picker without
 * reopening it when focus only comes back from the picker window.
 *
 * @see {@link file://./color-input.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorInput } from "./color-input";

const renderColorInput = (props: Record<string, unknown> = {}) =>
  render(<ColorInput name="color" colorFromServer="#4f46e5" {...props} />);

const hexField = () => screen.getByLabelText("Hex Color") as HTMLInputElement;
const swatch = () =>
  screen.getByLabelText("Choose a color") as HTMLInputElement;

describe("ColorInput", () => {
  it("starts both controls on the server color", () => {
    renderColorInput();
    expect(hexField().value).toBe("#4f46e5");
    expect(swatch().value).toBe("#4f46e5");
  });

  it("fills the hex field when a color is picked in the swatch", () => {
    renderColorInput();
    fireEvent.change(swatch(), { target: { value: "#12b76a" } });
    expect(hexField().value).toBe("#12b76a");
  });

  it("moves the swatch when a hex color is typed", () => {
    renderColorInput();
    fireEvent.change(hexField(), { target: { value: "#FFF" } });
    expect(swatch().value).toBe("#ffffff");
  });

  it("keeps the swatch on its last color while the typed hex is incomplete", () => {
    renderColorInput();
    fireEvent.change(hexField(), { target: { value: "#12" } });
    expect(hexField().value).toBe("#12");
    expect(swatch().value).toBe("#4f46e5");
  });

  it("submits only the hex field", () => {
    renderColorInput();
    expect(hexField()).toHaveAttribute("name", "color");
    expect(swatch()).not.toHaveAttribute("name");
  });

  it("disables the swatch with the field", () => {
    renderColorInput({ disabled: true });
    expect(swatch()).toBeDisabled();
  });
});

describe("ColorInput picker on focus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Stubs the browser's showPicker on the swatch; happy-dom has no picker UI. */
  const stubShowPicker = () => {
    const showPicker = vi.fn();
    // why: showPicker opens a native browser dialog that happy-dom does not implement
    Object.defineProperty(swatch(), "showPicker", {
      value: showPicker,
      configurable: true,
    });
    return showPicker;
  };

  it("opens the color picker when the hex field gets focus", () => {
    renderColorInput();
    const showPicker = stubShowPicker();
    fireEvent.focus(hexField());
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it("does not reopen when focus returns from the picker window", () => {
    renderColorInput();
    const showPicker = stubShowPicker();
    fireEvent.focus(hexField());

    // why: the picker window taking focus is a window-level blur happy-dom cannot produce
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.blur(hexField());
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fireEvent.focus(hexField());

    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it("opens again after the field was left and refocused", () => {
    renderColorInput();
    const showPicker = stubShowPicker();
    fireEvent.focus(hexField());
    fireEvent.blur(hexField());
    fireEvent.focus(hexField());
    expect(showPicker).toHaveBeenCalledTimes(2);
  });

  it("keeps the field usable when the browser refuses to open the picker", () => {
    renderColorInput();
    const showPicker = stubShowPicker();
    showPicker.mockImplementation(() => {
      throw new DOMException("No user activation", "NotAllowedError");
    });
    expect(() => fireEvent.focus(hexField())).not.toThrow();
  });

  it("does not open the picker while disabled", () => {
    renderColorInput({ disabled: true });
    const showPicker = stubShowPicker();
    fireEvent.focus(hexField());
    expect(showPicker).not.toHaveBeenCalled();
  });
});
