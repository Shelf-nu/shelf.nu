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
import { describe, it, expect, vi } from "vitest";

import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import { DateRangePicker } from "./date-range-picker";

// why: useDateFormatter reads useRequestInfo(), which needs the root loader's
// RequestInfo context (unavailable in a unit test). Stub the hook but back it
// with the REAL formatDate bound to MMM_DD_YYYY + UTC prefs, so the trigger
// summary genuinely exercises the formatter — in particular the bare-date
// no-shift path (the label formats the "YYYY-MM-DD" wire, never the Date, so it
// can't tz-shift). Cast avoids an inline import() type (consistent-type-imports).
vi.mock("~/hooks/use-date-formatter", async () => {
  const actual = (await vi.importActual("~/utils/date-format")) as {
    formatDate: (
      value: string | Date,
      prefs: ResolvedFormatPrefs,
      opts?: DateFormatOptions
    ) => string;
  };
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "MMM_DD_YYYY",
    timeFormat: "H12",
    weekStartsOn: 0,
    timeZone: "UTC",
  };
  return {
    useDateFormatter: () => ({
      prefs,
      formatDate: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, opts),
      formatTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, onlyTime: true }),
      formatDateTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, includeTime: true }),
    }),
  };
});

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
