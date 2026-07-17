/**
 * TimezoneSelect — unit tests
 *
 * Verifies the searchable timezone selector renders the current value in its
 * trigger, exposes a non-empty option list (from Intl.supportedValuesOf with
 * a fallback), and submits the value through the hidden input named by `name`.
 *
 * @see {@link file://./timezone-select.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TIMEZONE_OPTIONS, TimezoneSelect } from "./timezone-select";

describe("TimezoneSelect", () => {
  it("exposes a non-empty option list", () => {
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(0);
    expect(TIMEZONE_OPTIONS).toContain("UTC");
  });

  it("renders the current value in the trigger", () => {
    render(
      <TimezoneSelect
        name="timeZone"
        value="Europe/London"
        // why: these tests verify render + hidden-input submission only; onChange is stubbed, not exercised
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("Europe/London")).toBeTruthy();
  });

  it("submits the current value via a hidden input", () => {
    const { container } = render(
      <TimezoneSelect
        name="timeZone"
        value="America/New_York"
        // why: these tests verify render + hidden-input submission only; onChange is stubbed, not exercised
        onChange={vi.fn()}
      />
    );
    const hidden = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="timeZone"]'
    );
    expect(hidden?.value).toBe("America/New_York");
  });
});
