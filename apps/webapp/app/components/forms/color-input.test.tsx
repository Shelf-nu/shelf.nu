/**
 * ColorInput unit tests.
 *
 * Pins that the swatch (the browser's native color picker) and the hex text
 * field stay in step in both directions, and that only the hex field is
 * submitted with the form.
 *
 * @see {@link file://./color-input.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
