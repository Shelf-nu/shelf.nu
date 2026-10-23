/**
 * Regression tests for {@link DateCell} — report table date rendering.
 *
 * Guards the fix that dropped the hardcoded `month: "short"` shape option from
 * `DateCell`. With that option in place a `DD_MM_YYYY` user would still see a
 * month NAME ("6 Jul 2026") instead of their numeric preference. `DateCell`
 * now passes no shape options to `DateS`, so the acting user's resolved format
 * prefs (order, numeric-vs-name month, separator) fully decide the output.
 *
 * @see {@link file://./report-table.tsx} DateCell
 * @see {@link file://../shared/date.tsx} DateS
 */
import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import { DateCell } from "./report-table";

// why: DateS (rendered by DateCell) reads the user's format prefs through this
// hook, which reaches the root route loader (useRequestInfo →
// useRouteLoaderData). There's no router in a unit test, so stub the hook —
// but back it with the REAL `formatDate` bound to concrete DD/MM/YYYY + UTC
// prefs, so the test genuinely exercises the formatter's pref-driven output
// (a leftover `month: "short"` would produce "6 Jul 2026" and fail below).
vi.mock("~/hooks/use-date-formatter", async () => {
  // Cast the real module to just the piece we use — avoids an inline
  // `import()` type annotation (forbidden by consistent-type-imports).
  const actual = (await vi.importActual("~/utils/date-format")) as {
    formatDate: (
      value: string | Date,
      prefs: ResolvedFormatPrefs,
      opts?: DateFormatOptions
    ) => string;
  };
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H12",
    weekStartsOn: 1,
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

/** Render a single DateCell inside a valid table structure. */
function renderCell(node: ReactNode) {
  return render(
    <table>
      <tbody>
        <tr>
          <td>{node}</td>
        </tr>
      </tbody>
    </table>
  );
}

describe("DateCell", () => {
  it("renders a table date in the user's numeric pref format", () => {
    // why: table data dates must follow the pref's numeric style, not "6 Jul
    // 2026". Noon-UTC instant so the UTC-pref render is machine-tz independent.
    renderCell(<DateCell date={new Date(Date.UTC(2026, 6, 6, 12, 0, 0))} />);

    expect(screen.getByText("06/07/2026")).toBeTruthy(); // DD_MM_YYYY mock
  });

  it("appends the time part when includeTime is set", () => {
    // Consumed by the Asset-Activity "Date & Time" column.
    renderCell(
      <DateCell date={new Date(Date.UTC(2026, 6, 6, 15, 30, 0))} includeTime />
    );

    expect(screen.getByText("06/07/2026, 3:30 PM")).toBeTruthy();
  });

  it("renders an em-dash placeholder for a null date", () => {
    renderCell(<DateCell date={null} />);

    expect(screen.getByText("—")).toBeTruthy();
  });
});
