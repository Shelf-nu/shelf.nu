/**
 * DateRangePicker — component tests
 *
 * Verifies:
 *  - An empty range renders the placeholder in the trigger.
 *  - A complete `{from,to}` range renders the formatted summary
 *    ("<from> – <to>") through the (mocked) prefs-aware formatter.
 *  - `startName`/`endName` emit hidden inputs carrying date-only `YYYY-MM-DD`
 *    wires (never tz-shifted) for plain-form submission.
 *
 * @see {@link file://./date-range-picker.tsx}
 */
import { render, screen } from "@testing-library/react";
import { format } from "date-fns";
import { describe, it, expect, vi } from "vitest";

import { DateRangePicker } from "./date-range-picker";

// why: useDateFormatter reads useRequestInfo(), which needs the root loader's
// RequestInfo context (unavailable in a unit test). Stub the hook with a
// month-name formatter so the trigger summary is deterministic and independent
// of the machine's locale/timezone.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    prefs: {
      dateFormat: "MMM_DD_YYYY",
      timeFormat: "H12",
      weekStartsOn: 0,
      timeZone: "UTC",
    },
    // Mirrors a month-name pref: "Jul 20, 2026".
    formatDate: (value: string | Date) =>
      value instanceof Date ? format(value, "MMM d, yyyy") : value,
    formatTime: (v: string | Date) => String(v),
    formatDateTime: (v: string | Date) => String(v),
  }),
}));

describe("DateRangePicker", () => {
  it("renders the placeholder when no range is selected", () => {
    render(<DateRangePicker placeholder="Pick your dates" />);
    expect(screen.getByText("Pick your dates")).toBeTruthy();
  });

  it("renders the default placeholder when none is provided", () => {
    render(<DateRangePicker />);
    expect(screen.getByText("Select start and end date")).toBeTruthy();
  });

  it("renders the formatted summary for a complete range (month-name pref)", () => {
    render(
      <DateRangePicker
        value={{
          from: new Date(2026, 6, 20), // Jul 20, 2026 (local wall-clock)
          to: new Date(2026, 6, 24), // Jul 24, 2026
        }}
      />
    );
    expect(screen.getByText("Jul 20, 2026 – Jul 24, 2026")).toBeTruthy();
  });

  it("renders hidden inputs with date-only YYYY-MM-DD wires when names are set", () => {
    render(
      <DateRangePicker
        startName="createdAt_start"
        endName="createdAt_end"
        value={{
          from: new Date(2026, 6, 20),
          to: new Date(2026, 6, 24),
        }}
      />
    );

    const start = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="createdAt_start"]'
    );
    const end = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="createdAt_end"]'
    );
    expect(start?.value).toBe("2026-07-20");
    expect(end?.value).toBe("2026-07-24");
  });
});
