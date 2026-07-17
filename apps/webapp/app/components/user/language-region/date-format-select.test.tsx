/**
 * DateFormatSelect — unit tests
 *
 * Verifies the controlled small-enum selector renders the label for its
 * current `value` and submits that value through the hidden input named by
 * `name`, so it rides the surrounding LanguageRegionForm.
 *
 * @see {@link file://./date-format-select.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DateFormatSelect } from "./date-format-select";

describe("DateFormatSelect", () => {
  it("renders the label for the current value", () => {
    render(
      <DateFormatSelect
        name="dateFormat"
        value="YYYY_MM_DD"
        // why: these tests verify render + hidden-input submission only; onChange is stubbed, not exercised
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("Year / Month / Day")).toBeTruthy();
  });

  it("submits the current value via a hidden input", () => {
    const { container } = render(
      <DateFormatSelect
        name="dateFormat"
        value="DD_MM_YYYY"
        // why: these tests verify render + hidden-input submission only; onChange is stubbed, not exercised
        onChange={vi.fn()}
      />
    );
    const hidden = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="dateFormat"]'
    );
    expect(hidden?.value).toBe("DD_MM_YYYY");
  });
});
