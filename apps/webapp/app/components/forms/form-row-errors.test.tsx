/**
 * FormRowErrors unit tests.
 *
 * Pins that the component renders nothing when every field is valid, and that
 * each message gets its own id, so an input's accessible description names
 * only its own error even when several fields fail at once.
 *
 * @see {@link file://./form-row-errors.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormRowErrors, rowErrorId } from "./form-row-errors";

describe("FormRowErrors", () => {
  it("renders nothing when no field has an error", () => {
    const { container } = render(
      <FormRowErrors id="errors" errors={{ name: undefined, color: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("describes each input with its own error only", () => {
    render(
      <>
        <input
          aria-label="Name"
          aria-describedby={rowErrorId("errors", "name")}
        />
        <input
          aria-label="Color"
          aria-describedby={rowErrorId("errors", "color")}
        />
        <FormRowErrors
          id="errors"
          errors={{ name: "Name is required", color: "Enter a hex color" }}
        />
      </>
    );

    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
      "Name is required"
    );
    expect(screen.getByLabelText("Color")).toHaveAccessibleDescription(
      "Enter a hex color"
    );
  });

  it("lists only the fields that have an error", () => {
    render(
      <FormRowErrors
        id="errors"
        errors={{ name: undefined, color: "Enter a hex color" }}
      />
    );
    expect(screen.getByText("Enter a hex color")).toBeInTheDocument();
    expect(document.getElementById(rowErrorId("errors", "name"))).toBeNull();
  });
});
