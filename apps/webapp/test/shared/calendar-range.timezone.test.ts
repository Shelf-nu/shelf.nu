import {
  calendarDayKey,
  calendarDayKeyToDate,
  calendarMonthWindow,
} from "@shelf/datetime";

// @vitest-environment node

/**
 * The west-of-UTC guards for the companion's booking calendar date helpers.
 *
 * why a separate file that moves the clock: these helpers deliberately answer
 * in LOCAL time, so under `TZ=UTC` — which is what CI runs — a correct
 * implementation and the `new Date("2026-09-01")` bug it replaced agree
 * EXACTLY. Assertions written in the ordinary suite therefore cannot fail on a
 * revert, and the bug the calendar was built around would ship again with a
 * green board. The zone has to be part of the test.
 *
 * Node re-reads `process.env.TZ` on each Date operation, and vitest isolates
 * every test file in its own process, so setting it here reaches nothing else.
 *
 * @see {@link file://./calendar-range.test.ts} the zone-independent contract
 */

/** Runs `assert` with the process clock moved to `timeZone`, then restores it. */
function inTimeZone(timeZone: string, assert: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    assert();
  } finally {
    process.env.TZ = previous;
  }
}

/** One east of UTC and one west of it; only the second can catch this class. */
const EAST = "Europe/Sofia";
const WEST = "America/Los_Angeles";

describe("day keys west of UTC", () => {
  it("proves the zone actually moved, so a silent no-op cannot pass this file", () => {
    // A guard on the guard: if `process.env.TZ` stopped taking effect, every
    // assertion below would quietly run under the ambient zone again and this
    // file would go back to proving nothing.
    inTimeZone(WEST, () => {
      expect(new Date(2026, 8, 1).getTimezoneOffset()).toBeGreaterThan(0);
    });
    inTimeZone(EAST, () => {
      expect(new Date(2026, 8, 1).getTimezoneOffset()).toBeLessThan(0);
    });
  });

  it("parses a day key as the day it names, on both sides of UTC", () => {
    // `new Date("2026-09-01")` is the date-only form, which the spec parses as
    // UTC midnight. In Los Angeles that Date is 31 August, so a calendar
    // reading getMonth() off it asked the server for August while showing
    // September.
    for (const zone of [EAST, WEST]) {
      inTimeZone(zone, () => {
        const first = calendarDayKeyToDate("2026-09-01");
        expect(first.getFullYear()).toBe(2026);
        expect(first.getMonth()).toBe(8); // September, zero indexed
        expect(first.getDate()).toBe(1);
        expect(first.getHours()).toBe(0);
      });
    }
  });

  it("round-trips a day key through calendarDayKey in either zone", () => {
    for (const zone of [EAST, WEST]) {
      inTimeZone(zone, () => {
        expect(calendarDayKey(calendarDayKeyToDate("2026-09-01"))).toBe(
          "2026-09-01"
        );
      });
    }
  });

  it("builds the window for the month on screen, not the one before it", () => {
    // 1 Sep 2026 is a Tuesday and 30 Sep a Wednesday, so a Sunday-start grid
    // runs Sun 30 Aug to Sat 3 Oct. Read as 31 August, the whole window slid a
    // month early and the calendar requested bookings it would never draw.
    for (const zone of [EAST, WEST]) {
      inTimeZone(zone, () => {
        const { start, end } = calendarMonthWindow("2026-09-01");
        expect(calendarDayKey(start)).toBe("2026-08-30");
        expect(calendarDayKey(end)).toBe("2026-10-03");
      });
    }
  });

  it("honours the account's week start west of UTC too", () => {
    inTimeZone(WEST, () => {
      const { start, end } = calendarMonthWindow("2026-09-01", 1);
      expect(calendarDayKey(start)).toBe("2026-08-31"); // Monday
      expect(calendarDayKey(end)).toBe("2026-10-04"); // Sunday
    });
  });
});
