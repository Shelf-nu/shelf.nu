import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { HARDCODED_DEFAULT_PREFS } from "~/utils/date-format";
import type { WorkingHoursData, WeeklyScheduleJson } from "./types";
import {
  calculateBusinessHoursDuration,
  getBookingDefaultStartEndTimes,
  getOverrideDateKey,
  normalizeWorkingHoursForValidation,
} from "./utils";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

/**
 * Resolved prefs carrying a specific zone.
 *
 * Every case states the zone it means, and `~/utils/date-fns` is deliberately
 * NOT mocked — the assertions exercise the real conversion. Keep both
 * properties. A stand-in formatter agrees with production only by coincidence,
 * and `process.env.TZ` set in a hook is not a substitute for an explicit zone
 * (V8 does not reliably honour it after process start), so a suite leaning on
 * either passes for reasons unrelated to the code under test.
 */
function prefsFor(timeZone: string): ResolvedFormatPrefs {
  return { ...HARDCODED_DEFAULT_PREFS, timeZone };
}

describe("normalizeWorkingHoursForValidation", () => {
  it("should normalize valid working hours data", () => {
    expect.assertions(1);

    const rawWorkingHours = {
      enabled: true,
      weeklySchedule: {
        "0": { isOpen: false },
        "1": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "2": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "3": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "4": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "5": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "6": { isOpen: false },
      },
      overrides: [
        {
          id: "override-1",
          date: "2025-07-25",
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: "Holiday",
        },
      ],
    };

    const result = normalizeWorkingHoursForValidation(rawWorkingHours);

    expect(result).toEqual({
      enabled: true,
      weeklySchedule: rawWorkingHours.weeklySchedule,
      overrides: [
        {
          id: "override-1",
          date: "2025-07-25",
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: "Holiday",
        },
      ],
    });
  });

  it("should handle Date objects in overrides", () => {
    expect.assertions(1);

    const rawWorkingHours = {
      enabled: true,
      weeklySchedule: {},
      overrides: [
        {
          id: "override-1",
          date: "2025-07-25",
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: null,
        },
      ],
    };

    const result = normalizeWorkingHoursForValidation(rawWorkingHours);

    expect(result?.overrides[0].date).toBe("2025-07-25");
  });

  it("should return undefined for invalid data", () => {
    expect.assertions(3);

    expect(normalizeWorkingHoursForValidation(null)).toBeUndefined();
    expect(normalizeWorkingHoursForValidation(undefined)).toBeUndefined();
    expect(normalizeWorkingHoursForValidation({})).toBeUndefined();
  });

  it("should handle transformation errors gracefully", () => {
    expect.assertions(1);

    const invalidData = {
      enabled: true,
      weeklySchedule: null, // Invalid
      overrides: null, // Invalid
    };

    const result = normalizeWorkingHoursForValidation(invalidData);

    expect(result).toBeUndefined();
  });
});

describe("calculateBusinessHoursDuration", () => {
  const mockWorkingHours: WorkingHoursData = {
    enabled: true,
    weeklySchedule: {
      "0": { isOpen: false }, // Sunday
      "1": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Monday
      "2": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Tuesday
      "3": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Wednesday
      "4": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Thursday
      "5": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Friday
      "6": { isOpen: false }, // Saturday
    } as WeeklyScheduleJson,
    overrides: [],
  };

  it("should calculate duration by subtracting closed days", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday 3 PM
    const endDate = new Date("2025-07-28T17:00:00Z"); // Monday 5 PM

    const result = calculateBusinessHoursDuration(
      startDate,
      endDate,
      mockWorkingHours,
      "UTC"
    );

    // Total: 74 hours, Closed: 48 hours (Sat + Sun), Effective: 26 hours
    expect(result).toBe(26);
  });

  it("should handle single day booking", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-28T10:00:00Z"); // Monday 10 AM
    const endDate = new Date("2025-07-28T15:00:00Z"); // Monday 3 PM

    const result = calculateBusinessHoursDuration(
      startDate,
      endDate,
      mockWorkingHours,
      "UTC"
    );

    // 5 hours on an open day
    expect(result).toBe(5);
  });

  it("should handle booking entirely on closed days", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-26T10:00:00Z"); // Saturday 10 AM
    const endDate = new Date("2025-07-27T15:00:00Z"); // Sunday 3 PM

    const result = calculateBusinessHoursDuration(
      startDate,
      endDate,
      mockWorkingHours,
      "UTC"
    );

    // Total: 29 hours, All closed: 29 hours, Effective: 0 hours
    expect(result).toBe(0);
  });

  it("should handle multiple week span", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday 3 PM
    const endDate = new Date("2025-08-01T17:00:00Z"); // Next Friday 5 PM

    const result = calculateBusinessHoursDuration(
      startDate,
      endDate,
      mockWorkingHours,
      "UTC"
    );

    // Total: 170 hours, Closed: 48 hours (1 weekend: Sat + Sun), Effective: 122 hours
    expect(result).toBe(122);
  });

  it("should handle date-specific overrides", () => {
    expect.assertions(1);

    const workingHoursWithHoliday: WorkingHoursData = {
      ...mockWorkingHours,
      overrides: [
        {
          id: "holiday",
          date: new Date("2025-07-28"), // Monday is closed (holiday) - absolute date
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: "Holiday",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2025-01-01T00:00:00.000Z"),
          workingHoursId: "working-hours-1",
        },
      ],
    };

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday 3 PM
    const endDate = new Date("2025-07-29T17:00:00Z"); // Tuesday 5 PM

    const result = calculateBusinessHoursDuration(
      startDate,
      endDate,
      workingHoursWithHoliday,
      "UTC"
    );

    // Total: 98 hours, Closed: 72 hours (Sat + Sun + Mon holiday), Effective: 26 hours
    expect(result).toBe(26);
  });

  it("should handle partial day calculations correctly", () => {
    expect.assertions(1);

    // Friday 3:30 PM to Monday 2:30 PM
    const startDate = new Date("2025-07-25T15:30:00Z");
    const endDate = new Date("2025-07-28T14:30:00Z");

    const result = calculateBusinessHoursDuration(
      startDate,
      endDate,
      mockWorkingHours,
      "UTC"
    );

    // Total: 71 hours, Closed: 48 hours (full weekend), Effective: 23 hours
    expect(result).toBe(23);
  });
});

describe("getBookingDefaultStartEndTimes", () => {
  // why: the defaults are computed relative to "now", so pinning the clock is
  // what makes the expected wall-clocks assertable instead of drifting. The
  // suite no longer touches process.env.TZ — each case passes the zone it means,
  // so the machine's own timezone cannot affect the result.
  beforeEach(() => {
    // Mock current time to Friday, July 25, 2025 at 2 PM UTC
    vitest.useFakeTimers();
    vitest.setSystemTime(new Date("2025-07-25T14:00:00Z"));
  });

  afterEach(() => {
    vitest.useRealTimers();
  });

  const mockWorkingHours: WorkingHoursData = {
    enabled: true,
    weeklySchedule: {
      "0": { isOpen: false }, // Sunday
      "1": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Monday
      "2": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Tuesday
      "3": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Wednesday
      "4": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Thursday
      "5": { isOpen: true, openTime: "09:00", closeTime: "17:00" }, // Friday
      "6": { isOpen: false }, // Saturday
    } as WeeklyScheduleJson,
    overrides: [],
  };

  it("should use fallback logic when working hours disabled", () => {
    expect.assertions(1);

    const disabledWorkingHours = { ...mockWorkingHours, enabled: false };

    const result = getBookingDefaultStartEndTimes(
      disabledWorkingHours,
      2,
      false,
      prefsFor("UTC")
    );

    // Should use original logic with 2-hour buffer
    expect(result.startDate).toBe("2025-07-25T16:00:00"); // Current + 2 hours
  });

  it("should use fallback logic when no working hours data", () => {
    expect.assertions(1);

    const result = getBookingDefaultStartEndTimes(
      null,
      1,
      false,
      prefsFor("UTC")
    );

    // Should use original logic with 1-hour buffer
    expect(result.startDate).toBe("2025-07-25T15:00:00"); // Current + 1 hour
  });

  it("should handle current time within working hours", () => {
    expect.assertions(2);

    const result = getBookingDefaultStartEndTimes(
      mockWorkingHours,
      0,
      false,
      prefsFor("UTC")
    );

    // Since we're within working hours (2 PM on Friday), use 10-minute buffer
    expect(result.startDate).toBe("2025-07-25T14:10:00"); // Current time + 10 minutes
    expect(result.endDate).toBe("2025-07-25T17:00:00"); // End of current working day
  });

  it("should handle buffer time within working hours", () => {
    expect.assertions(2);

    const result = getBookingDefaultStartEndTimes(
      mockWorkingHours,
      2,
      false,
      prefsFor("UTC")
    );

    // Since we're within working hours and buffer doesn't exceed closing time
    expect(result.startDate).toBe("2025-07-25T16:00:00"); // Current time + 2 hours buffer
    expect(result.endDate).toBe("2025-07-25T17:00:00"); // End of current working day
  });

  it("should find next working day when outside hours", () => {
    expect.assertions(2);

    // Mock time to Saturday (closed day)
    vitest.setSystemTime(new Date("2025-07-26T14:00:00Z"));

    const result = getBookingDefaultStartEndTimes(
      mockWorkingHours,
      0,
      false,
      prefsFor("UTC")
    );

    expect(result.startDate).toBe("2025-07-28T09:00:00"); // Next Monday 9 AM UTC
    expect(result.endDate).toBe("2025-07-28T17:00:00"); // Next Monday 5 PM UTC
  });

  it("should handle buffer time that extends past working hours", () => {
    expect.assertions(2);

    // Mock time to late Friday afternoon
    vitest.setSystemTime(new Date("2025-07-25T16:30:00Z"));

    const result = getBookingDefaultStartEndTimes(
      mockWorkingHours,
      2,
      false,
      prefsFor("UTC")
    );

    // Buffer would put us at 6:30 PM, past closing, so use next working day
    expect(result.startDate).toBe("2025-07-28T09:00:00"); // Next Monday 9 AM UTC
    expect(result.endDate).toBe("2025-07-28T17:00:00"); // Next Monday 5 PM UTC
  });

  it("should handle date-specific overrides", () => {
    expect.assertions(2);

    const workingHoursWithOverride: WorkingHoursData = {
      ...mockWorkingHours,
      overrides: [
        {
          id: "today-closed",
          date: new Date("2025-07-25"), // Today (Friday) is closed - absolute date
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: "Company event",
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2025-01-01T00:00:00.000Z"),
          workingHoursId: "working-hours-1",
        },
      ],
    };

    const result = getBookingDefaultStartEndTimes(
      workingHoursWithOverride,
      0,
      false,
      prefsFor("UTC")
    );

    expect(result.startDate).toBe("2025-07-28T09:00:00"); // Next Monday 9 AM UTC
    expect(result.endDate).toBe("2025-07-28T17:00:00"); // Next Monday 5 PM UTC
  });

  it("should bypass buffer time for admin/owner users", () => {
    expect.assertions(2);

    // Base user with 24-hour buffer should get time 24 hours from now
    const baseUserResult = getBookingDefaultStartEndTimes(
      mockWorkingHours,
      24,
      false,
      prefsFor("UTC")
    );
    expect(baseUserResult.startDate).toBe("2025-07-28T09:00:00"); // Next working day (buffer pushes to Monday)

    // Admin user with same 24-hour buffer should get time ~10 minutes from now
    const adminUserResult = getBookingDefaultStartEndTimes(
      mockWorkingHours,
      24,
      true,
      prefsFor("UTC")
    );
    expect(adminUserResult.startDate).toBe("2025-07-25T14:10:00"); // Current time + 10 minutes (buffer bypassed)
  });

  it("should bypass buffer time for admin/owner when working hours disabled", () => {
    expect.assertions(2);

    const disabledWorkingHours = { ...mockWorkingHours, enabled: false };

    // Base user with 10-hour buffer
    const baseUserResult = getBookingDefaultStartEndTimes(
      disabledWorkingHours,
      10,
      false,
      prefsFor("UTC")
    );
    expect(baseUserResult.startDate).toBe("2025-07-26T00:00:00"); // Current + 10 hours = next day midnight

    // Admin user with same 10-hour buffer should get 10 minutes from now
    const adminUserResult = getBookingDefaultStartEndTimes(
      disabledWorkingHours,
      10,
      true,
      prefsFor("UTC")
    );
    expect(adminUserResult.startDate).toBe("2025-07-25T14:10:00"); // Current time + 10 minutes (buffer bypassed)
  });

  /**
   * What `prefs` is for: the form field displays and submits in the user's
   * PREFERENCE zone, so the defaults it is seeded with must be computed there
   * too. Computed on the ambient clock instead, they land hours off for anyone
   * whose device zone differs.
   *
   * These cases pass the same instant with different prefs and assert different
   * wall-clocks, so they pin the zone as the thing driving the result rather
   * than the machine the suite happens to run on.
   */
  describe("preference zone drives the result", () => {
    it("returns the wall-clock of the preference zone, not UTC", () => {
      expect.assertions(2);

      // 14:00Z with working hours disabled → start is "now + 10 minutes",
      // expressed in whichever zone the user prefers.
      const utc = getBookingDefaultStartEndTimes(
        null,
        0,
        false,
        prefsFor("UTC")
      );
      const losAngeles = getBookingDefaultStartEndTimes(
        null,
        0,
        false,
        prefsFor("America/Los_Angeles")
      );

      expect(utc.startDate).toBe("2025-07-25T14:10:00");
      // Same instant, PDT (UTC-7) → 07:10 local, and still the 25th.
      expect(losAngeles.startDate).toBe("2025-07-25T07:10:00");
    });

    it("picks the working day of the preference zone when zones straddle midnight", () => {
      expect.assertions(2);

      // 2025-07-25T23:30Z is still FRIDAY in UTC but already SATURDAY in Tokyo
      // (UTC+9, 08:30 on the 26th).
      //
      // Saturday is opened on DIFFERENT hours from the weekday schedule so the
      // two zones cannot produce the same answer. With Saturday closed (as the
      // shared fixture has it) both zones funnel to Monday 09:00 and the case
      // proves nothing — a build reading the calendar day off UTC while still
      // formatting in the preference zone would pass it.
      vitest.setSystemTime(new Date("2025-07-25T23:30:00Z"));

      const saturdayOpen: WorkingHoursData = {
        ...mockWorkingHours,
        weeklySchedule: {
          ...mockWorkingHours.weeklySchedule,
          "6": { isOpen: true, openTime: "10:00", closeTime: "14:00" },
        } as WeeklyScheduleJson,
      };

      const utc = getBookingDefaultStartEndTimes(
        saturdayOpen,
        0,
        false,
        prefsFor("UTC")
      );
      const tokyo = getBookingDefaultStartEndTimes(
        saturdayOpen,
        0,
        false,
        prefsFor("Asia/Tokyo")
      );

      // UTC: Friday 23:30, past Friday's 17:00 close → next open day is
      // Saturday, which now opens at 10:00.
      expect(utc.startDate).toBe("2025-07-26T10:00:00");
      // Tokyo: already Saturday 08:30, and the search only ever starts from
      // TOMORROW → Sunday (closed), then Monday 09:00 Tokyo. Different calendar
      // day and different wall clock from UTC.
      expect(tokyo.startDate).toBe("2025-07-28T09:00:00");
    });

    it("resolves a date override against the preference zone's calendar day", () => {
      expect.assertions(2);

      // Friday the 25th carries an override. At 23:30Z it is still the 25th in
      // UTC, so the override applies there; in Tokyo it is already the 26th, so
      // it does not.
      //
      // The override OPENS Friday late rather than closing it. A closed-Friday
      // override is inert at this instant — 23:30 is past the normal 17:00 close
      // either way — so it could be deleted without changing either assertion.
      // Opening late makes the override the only thing that separates the zones.
      vitest.setSystemTime(new Date("2025-07-25T23:30:00Z"));

      const workingHoursWithOverride: WorkingHoursData = {
        ...mockWorkingHours,
        overrides: [
          {
            id: "friday-late",
            date: new Date("2025-07-25"),
            isOpen: true,
            openTime: "20:00",
            closeTime: "23:59",
            reason: "Late event",
            createdAt: new Date("2025-01-01T00:00:00.000Z"),
            updatedAt: new Date("2025-01-01T00:00:00.000Z"),
            workingHoursId: "working-hours-1",
          },
        ],
      };

      const utc = getBookingDefaultStartEndTimes(
        workingHoursWithOverride,
        0,
        false,
        prefsFor("UTC")
      );
      const tokyo = getBookingDefaultStartEndTimes(
        workingHoursWithOverride,
        0,
        false,
        prefsFor("Asia/Tokyo")
      );

      // UTC: still the 25th → override applies, and 23:30 sits inside
      // 20:00-23:59 → the in-hours branch, i.e. now + 10 minutes.
      expect(utc.startDate).toBe("2025-07-25T23:40:00");
      // Tokyo: already the 26th → the override does not apply. Saturday and
      // Sunday are closed, so the next open day is Monday.
      expect(tokyo.startDate).toBe("2025-07-28T09:00:00");
    });
  });
});

describe("getOverrideDateKey", () => {
  // Overrides are stored as UTC-midnight Date values that represent an absolute
  // calendar date. Formatting them in the runtime's local timezone would shift
  // the date backwards for users west of UTC (e.g. Central Time), which caused
  // overrides for day D to match bookings on day D-1.
  it("returns the YYYY-MM-DD portion of an ISO string", () => {
    expect(getOverrideDateKey("2026-04-24T00:00:00.000Z")).toBe("2026-04-24");
  });

  it("returns the stored date for a date-only string", () => {
    expect(getOverrideDateKey("2026-04-24")).toBe("2026-04-24");
  });

  it("returns the UTC calendar date for a Date object", () => {
    // new Date("2026-04-24") stores UTC midnight; in any runtime timezone the
    // override still refers to the 24th.
    expect(getOverrideDateKey(new Date("2026-04-24"))).toBe("2026-04-24");
  });

  it("reads the UTC calendar day for a Date not at UTC midnight", () => {
    // Pins down the "read the UTC day, not the local day" semantic. This Date
    // is 4/24 23:30 in CDT, which is 4/25 04:30 UTC — we expect the UTC day.
    expect(getOverrideDateKey(new Date("2026-04-24T23:30:00-05:00"))).toBe(
      "2026-04-25"
    );
  });
});

/**
 * Closed-day math must be done in the zone the caller supplies.
 *
 * The walk asks "is this day open?" day by day, so the answer turns entirely on
 * which calendar day an instant falls in — and that is a property of the zone,
 * not of the machine. An implementation that reads the day off the ambient clock
 * gives one answer in the browser and another on the server for the same
 * booking, and CI (which runs UTC) would not notice.
 *
 * The case below passes the SAME instants through two zones and asserts
 * DIFFERENT results, so an implementation that ignores the zone cannot pass.
 * Keep that shape when adding cases here: two zones agreeing proves nothing.
 */
describe("closed-day math is zone-driven", () => {
  const weekdaysOpen: WorkingHoursData = {
    enabled: true,
    weeklySchedule: {
      "0": { isOpen: false }, // Sunday
      "1": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
      "2": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
      "3": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
      "4": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
      "5": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
      "6": { isOpen: false }, // Saturday
    } as WeeklyScheduleJson,
    overrides: [],
  };

  it("calculateBusinessHoursDuration attributes closed hours per zone", () => {
    expect.assertions(2);

    // 8 calendar hours spanning the UTC Friday→Saturday midnight boundary.
    const start = new Date("2025-07-25T20:00:00Z");
    const end = new Date("2025-07-26T04:00:00Z");

    // UTC: 20:00-24:00 is Friday (open), 00:00-04:00 is Saturday (closed).
    // 8 total - 4 closed = 4.
    expect(
      calculateBusinessHoursDuration(start, end, weekdaysOpen, "UTC")
    ).toBe(4);

    // Asia/Tokyo (+9): the window is Sat 05:00 → Sat 13:00 local, entirely
    // inside a closed Saturday. 8 total - 8 closed = 0.
    expect(
      calculateBusinessHoursDuration(start, end, weekdaysOpen, "Asia/Tokyo")
    ).toBe(0);
  });
});
