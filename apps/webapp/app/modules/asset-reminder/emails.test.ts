// @vitest-environment node
/**
 * Tests for the recurrence line in the asset reminder email: its wording for
 * every kind of cadence label, and that the next date follows the
 * recipient's own date format and timezone.
 *
 * @see {@link file://./emails.tsx}
 */
import { ReminderRecurrenceUnit } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { recurrenceLine } from "./emails";

const NEXT = new Date("2026-10-27T14:10:00.000Z");

/** A recipient in Sofia who reads dates as "Oct 27, 2026" on a 24h clock. */
const SOFIA_PREFS: ResolvedFormatPrefs = {
  dateFormat: "MMM_DD_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "Europe/Sofia",
};

function cadence(unit: ReminderRecurrenceUnit, interval: number) {
  return {
    recurrenceUnit: unit,
    recurrenceInterval: interval,
    recurrenceTimezone: "UTC",
  };
}

describe("recurrenceLine", () => {
  it("reads 'Repeats every 3 months' for a phrase label", () => {
    expect(
      recurrenceLine(cadence(ReminderRecurrenceUnit.MONTH, 3), NEXT)
    ).toMatch(/^Repeats every 3 months\. Next reminder: /);
  });

  it("reads 'Repeats monthly' for an adjective label", () => {
    expect(
      recurrenceLine(cadence(ReminderRecurrenceUnit.MONTH, 1), NEXT)
    ).toMatch(/^Repeats monthly\. Next reminder: /);
  });

  it("formats the next date in the recipient's format and timezone", () => {
    const line = recurrenceLine(
      cadence(ReminderRecurrenceUnit.DAY, 1),
      NEXT,
      SOFIA_PREFS
    );

    expect(line).toBe(
      "Repeats daily. Next reminder: Oct 27, 2026, 16:10 (Europe/Sofia)."
    );
  });

  it("falls back to the series' timezone without recipient prefs", () => {
    expect(
      recurrenceLine(cadence(ReminderRecurrenceUnit.DAY, 1), NEXT)
    ).toContain("(UTC)");
  });

  it("is empty for a one-time reminder", () => {
    expect(
      recurrenceLine(
        {
          recurrenceUnit: null,
          recurrenceInterval: null,
          recurrenceTimezone: null,
        },
        NEXT
      )
    ).toBeNull();
  });

  it("says the series ended on its last occurrence", () => {
    expect(
      recurrenceLine(
        cadence(ReminderRecurrenceUnit.DAY, 1),
        null,
        SOFIA_PREFS,
        "ended"
      )
    ).toBe(
      "This was the last occurrence of this recurring reminder: the next one would fall after its end date."
    );
  });

  it("says later occurrences are held back after a downgrade", () => {
    expect(
      recurrenceLine(
        cadence(ReminderRecurrenceUnit.DAY, 1),
        null,
        undefined,
        "paused"
      )
    ).toContain("will not be sent until the workspace plan");
  });
});
