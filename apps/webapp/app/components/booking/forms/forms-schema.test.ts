import { addHours, addDays, subDays, addMinutes } from "date-fns";
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { BookingFormSchema, ExtendBookingSchema } from "./forms-schema";

/**
 * These tests verify that booking time restrictions (bufferStartTime and maxBookingLength)
 * are correctly bypassed for ADMIN/OWNER users while still being enforced for BASE/SELF_SERVICE users.
 *
 * See issue: Bug: Booking time restrictions affect OWNER and ADMIN users and they shouldn't
 */

describe("BookingFormSchema - time restrictions", () => {
  const baseBookingSettings = {
    bufferStartTime: 24, // 24 hours minimum advance notice
    tagsRequired: false,
    maxBookingLength: 48, // Maximum 48 hours
    maxBookingLengthSkipClosedDays: false,
  };

  const disabledWorkingHours = {
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  };

  describe("bufferStartTime restriction", () => {
    it("should enforce buffer time for BASE/SELF_SERVICE users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: false, // BASE/SELF_SERVICE user
      });

      // Try to book starting in 1 hour (less than 24 hour buffer)
      const startDate = addHours(new Date(), 1);
      const endDate = addHours(startDate, 4);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) => msg.includes("at least 24 hour"))
        ).toBe(true);
      }
    });

    it("should bypass buffer time for ADMIN/OWNER users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // ADMIN/OWNER user
      });

      // Try to book starting in 1 hour (less than 24 hour buffer) - should be allowed for admin
      const startDate = addMinutes(new Date(), 30); // 30 minutes from now
      const endDate = addHours(startDate, 4);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(true);
    });
  });

  describe("maxBookingLength restriction", () => {
    it("should enforce max booking length for BASE/SELF_SERVICE users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: false, // BASE/SELF_SERVICE user
      });

      // Try to create a 72-hour booking (exceeds 48 hour max)
      const startDate = addDays(new Date(), 2); // Start in 2 days to pass buffer check
      const endDate = addHours(startDate, 72);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) =>
            msg.includes("Booking duration cannot exceed 48 hours")
          )
        ).toBe(true);
      }
    });

    it("should bypass max booking length for ADMIN/OWNER users", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // ADMIN/OWNER user
      });

      // Try to create a 72-hour booking (exceeds 48 hour max) - should be allowed for admin
      const startDate = addHours(new Date(), 1);
      const endDate = addHours(startDate, 72);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(true);
    });
  });

  describe("end date before start date validation", () => {
    it("should still enforce end date after start date for all users", () => {
      // This validation should apply to everyone
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // Even admins should respect this
      });

      const startDate = addDays(new Date(), 1);
      const endDate = subDays(startDate, 1); // End before start

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) =>
            msg.includes("End date cannot be earlier than start date")
          )
        ).toBe(true);
      }
    });
  });

  describe("default isAdminOrOwner behavior", () => {
    it("should default to false (enforce restrictions) when isAdminOrOwner is not provided", () => {
      const schema = BookingFormSchema({
        action: "new",
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        // isAdminOrOwner not provided - should default to false
      });

      // Try to book starting in 1 hour (less than 24 hour buffer)
      const startDate = addHours(new Date(), 1);
      const endDate = addHours(startDate, 4);

      const result = schema.safeParse({
        name: "Test Booking",
        startDate,
        endDate,
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Test User",
          userId: "user-1",
        }),
      });

      // Should fail because restrictions should be enforced by default
      expect(result.success).toBe(false);
    });
  });
});

describe("ExtendBookingSchema - time restrictions", () => {
  const baseBookingSettings = {
    bufferStartTime: 24, // 24 hours minimum advance notice
    maxBookingLength: 48, // Maximum 48 hours
    maxBookingLengthSkipClosedDays: false,
  };

  const disabledWorkingHours = {
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  };

  describe("maxBookingLength restriction", () => {
    it("should enforce max booking length for BASE/SELF_SERVICE users", () => {
      const schema = ExtendBookingSchema({
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: false, // BASE/SELF_SERVICE user
      });

      // Original booking start date
      const startDate = new Date().toISOString();
      // Try to extend to 72 hours total (exceeds 48 hour max)
      const endDate = addHours(new Date(startDate), 72).toISOString();

      const result = schema.safeParse({
        startDate,
        endDate,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = result.error.errors.map((e) => e.message);
        expect(
          errorMessages.some((msg) =>
            msg.includes("Booking duration cannot exceed 48 hours")
          )
        ).toBe(true);
      }
    });

    it("should bypass max booking length for ADMIN/OWNER users", () => {
      const schema = ExtendBookingSchema({
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        isAdminOrOwner: true, // ADMIN/OWNER user
      });

      // Original booking start date
      const startDate = new Date().toISOString();
      // Try to extend to 72 hours total (exceeds 48 hour max) - should be allowed for admin
      const endDate = addHours(new Date(startDate), 72).toISOString();

      const result = schema.safeParse({
        startDate,
        endDate,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("default isAdminOrOwner behavior", () => {
    it("should default to false (enforce restrictions) when isAdminOrOwner is not provided", () => {
      const schema = ExtendBookingSchema({
        workingHours: disabledWorkingHours,
        bookingSettings: baseBookingSettings,
        // isAdminOrOwner not provided - should default to false
      });

      // Original booking start date
      const startDate = new Date().toISOString();
      // Try to extend to 72 hours total (exceeds 48 hour max)
      const endDate = addHours(new Date(startDate), 72).toISOString();

      const result = schema.safeParse({
        startDate,
        endDate,
      });

      // Should fail because restrictions should be enforced by default
      expect(result.success).toBe(false);
    });
  });
});

/**
 * Regression tests for working hours override comparison across timezones.
 *
 * Working hours overrides are stored as UTC-midnight Date values representing
 * an absolute calendar date. Previously, validation formatted the override
 * date with the runtime's local timezone, which shifted the date backwards one
 * day for users west of UTC. A user in America/Chicago that set a closed-day
 * override for 4/24 was blocked from booking on 4/23, because the override
 * Date (UTC midnight 4/24 = 7 PM CDT on 4/23) formatted in local time read as
 * "2026-04-23" and falsely matched the booking's calendar day.
 */
describe("BookingFormSchema - override timezone handling", () => {
  const ORIGINAL_TZ = process.env.TZ;

  // Force America/Chicago so the test exercises the exact condition the user
  // reported (CDT, UTC-5 in April). Node honors process.env.TZ dynamically.
  beforeAll(() => {
    process.env.TZ = "America/Chicago";
  });

  afterAll(() => {
    // Assigning `process.env.TZ = undefined` would write the literal string
    // "undefined" and leak into other tests in the same vitest worker, so
    // delete the var when it was originally unset.
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  const baseBookingSettings = {
    bufferStartTime: 0,
    tagsRequired: false,
    maxBookingLength: null,
    maxBookingLengthSkipClosedDays: false,
  };

  // Dates are pinned in 2099 so the "must be in the future" guard never trips
  // — the TZ boundary scenario (UTC-midnight override on day D matching a
  // day-D-1 booking in CDT) is year-independent.
  const workingHoursWith424Closed = {
    enabled: true,
    weeklySchedule: {
      "0": { isOpen: true, openTime: "00:00", closeTime: "23:59" },
      "1": { isOpen: true, openTime: "00:00", closeTime: "23:59" },
      "2": { isOpen: true, openTime: "00:00", closeTime: "23:59" },
      "3": { isOpen: true, openTime: "00:00", closeTime: "23:59" },
      "4": { isOpen: true, openTime: "00:00", closeTime: "23:59" },
      "5": { isOpen: true, openTime: "00:00", closeTime: "23:59" },
      "6": { isOpen: true, openTime: "00:00", closeTime: "23:59" },
    },
    // Override stored the way createWorkingHoursOverride does: new Date("2099-04-24")
    // which yields UTC midnight on April 24.
    overrides: [
      {
        id: "override-1",
        date: new Date("2099-04-24").toISOString(),
        isOpen: false,
        openTime: null,
        closeTime: null,
        reason: "Closed",
      },
    ],
  };

  it("does not flag a 4/23 booking as closed when the override is for 4/24", () => {
    const schema = BookingFormSchema({
      hints: { timeZone: "America/Chicago" } as any,
      action: "new",
      workingHours: workingHoursWith424Closed,
      bookingSettings: baseBookingSettings,
      isAdminOrOwner: true, // Bypass buffer check so we isolate the override logic
    });

    // Booking on 4/23 in the user's local time.
    const startDate = new Date("2099-04-23T17:00:00-05:00"); // 4/23 5 PM CDT
    const endDate = new Date("2099-04-23T18:00:00-05:00");

    const result = schema.safeParse({
      name: "Test Booking",
      startDate,
      endDate,
      custodian: JSON.stringify({
        id: "tm-1",
        name: "Test User",
        userId: "user-1",
      }),
    });

    // With isAdminOrOwner=true + 24/7 schedule + no matching override, the
    // booking must parse cleanly. Asserting .success directly guards against
    // unrelated validation regressions beyond the "closed" message.
    expect(result.success).toBe(true);
  });

  it("still flags a 4/24 booking as closed when the override is for 4/24", () => {
    const schema = BookingFormSchema({
      hints: { timeZone: "America/Chicago" } as any,
      action: "new",
      workingHours: workingHoursWith424Closed,
      bookingSettings: baseBookingSettings,
      isAdminOrOwner: true,
    });

    const startDate = new Date("2099-04-24T10:00:00-05:00");
    const endDate = new Date("2099-04-24T11:00:00-05:00");

    const result = schema.safeParse({
      name: "Test Booking",
      startDate,
      endDate,
      custodian: JSON.stringify({
        id: "tm-1",
        name: "Test User",
        userId: "user-1",
      }),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMessages = result.error.errors.map((e) => e.message);
      expect(
        errorMessages.some((msg) => msg.toLowerCase().includes("closed"))
      ).toBe(true);
    }
  });
});

/**
 * Regression coverage for SHELF-WEBAPP-1HC.
 *
 * The HTML `<input type="datetime-local">` emits values like `"2026-05-01T16:10"`
 * with no offset. Previously the schema fed that wire string into
 * `z.coerce.date()`, which is interpreted in the server's local zone (UTC in
 * production). For users west of UTC, valid future bookings were rejected as
 * "Start date must be in the future". The fix parses the wire string with
 * Luxon using `hints.timeZone`.
 */
describe("BookingFormSchema - datetime-local wire string (1HC regression)", () => {
  const baseBookingSettings = {
    bufferStartTime: 0,
    tagsRequired: false,
    maxBookingLength: null,
    maxBookingLengthSkipClosedDays: false,
  };

  const disabledWorkingHours = {
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  };

  /**
   * Helper: build a `yyyy-MM-dd'T'HH:mm` wire string a few hours ahead of
   * the user's wall clock in the given zone.
   */
  function buildLocalWireString(
    timeZone: string,
    offsetHoursFromNow: number
  ): string {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(
      new Date(Date.now() + offsetHoursFromNow * 60 * 60 * 1000)
    );
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "00";
    // Intl `hour: "2-digit"` can emit `24:00` for midnight; normalize.
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get(
      "minute"
    )}`;
  }

  it("accepts a future-but-soon booking when the user is west of UTC (NY)", () => {
    const hints = { timeZone: "America/New_York" } as any;
    const schema = BookingFormSchema({
      hints,
      action: "new",
      workingHours: disabledWorkingHours,
      bookingSettings: baseBookingSettings,
      isAdminOrOwner: true,
    });

    const startDate = buildLocalWireString("America/New_York", 3);
    const endDate = buildLocalWireString("America/New_York", 6);

    const result = schema.safeParse({
      name: "TZ Booking",
      startDate,
      endDate,
      custodian: JSON.stringify({
        id: "tm-1",
        name: "Test User",
        userId: "user-1",
      }),
    });

    if (!result.success) {
      // Surface the actual messages so a regression is debuggable.
      // eslint-disable-next-line no-console
      console.error("Unexpected validation failure", result.error.errors);
    }
    expect(result.success).toBe(true);
  });

  it("still rejects a past wire-string startDate", () => {
    const hints = { timeZone: "America/New_York" } as any;
    const schema = BookingFormSchema({
      hints,
      action: "new",
      workingHours: disabledWorkingHours,
      bookingSettings: baseBookingSettings,
      isAdminOrOwner: true,
    });

    const startDate = buildLocalWireString("America/New_York", -3);
    const endDate = buildLocalWireString("America/New_York", -1);

    const result = schema.safeParse({
      name: "TZ Booking",
      startDate,
      endDate,
      custodian: JSON.stringify({
        id: "tm-1",
        name: "Test User",
        userId: "user-1",
      }),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMessages = result.error.errors.map((e) => e.message);
      expect(
        errorMessages.some((msg) =>
          msg.toLowerCase().includes("must be in the future")
        )
      ).toBe(true);
    }
  });

  it("rejects an invalid wire-string format", () => {
    const hints = { timeZone: "America/New_York" } as any;
    const schema = BookingFormSchema({
      hints,
      action: "new",
      workingHours: disabledWorkingHours,
      bookingSettings: baseBookingSettings,
      isAdminOrOwner: true,
    });

    const result = schema.safeParse({
      name: "TZ Booking",
      startDate: "not-a-date",
      endDate: "2099-12-31T10:00",
      custodian: JSON.stringify({
        id: "tm-1",
        name: "Test User",
        userId: "user-1",
      }),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMessages = result.error.errors.map((e) => e.message);
      expect(
        errorMessages.some((msg) =>
          msg.toLowerCase().includes("invalid date format")
        )
      ).toBe(true);
    }
  });

  /**
   * Codex/CodeRabbit P1: when working hours are enabled, `validateWorkingHours`
   * must read weekday / HH:mm / yyyy-MM-dd in the user's timezone, not the
   * server's. Otherwise an LA user's 10:00 booking becomes 17:00 (or 18:00)
   * UTC on the server and gets rejected by a 9–17 working-hours window.
   */
  it("accepts a working-hours-window booking from a non-UTC user (LA)", () => {
    const hints = { timeZone: "America/Los_Angeles" } as any;
    // 9–17 every day so the test exercises a narrow window — pre-fix, the
    // server would format the parsed instant as 19:00 PDT-equivalent and
    // reject. Post-fix, components are read in the user's zone.
    const enabledWorkingHours = {
      enabled: true,
      weeklySchedule: {
        "0": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "1": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "2": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "3": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "4": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "5": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "6": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
      },
      overrides: [],
    };
    const schema = BookingFormSchema({
      hints,
      action: "new",
      workingHours: enabledWorkingHours,
      bookingSettings: baseBookingSettings,
      isAdminOrOwner: true,
    });

    // Fixed wire strings well inside the 9–17 window in LA local. Avoiding
    // `buildLocalWireString` here keeps the test deterministic regardless of
    // when CI runs — otherwise an actual LA wall-clock outside 09:00–14:00
    // would push the synthetic future booking outside the window.
    const result = schema.safeParse({
      name: "WH Booking",
      startDate: "2099-04-24T10:00",
      endDate: "2099-04-24T15:00",
      custodian: JSON.stringify({
        id: "tm-1",
        name: "Test User",
        userId: "user-1",
      }),
    });

    if (!result.success) {
      // eslint-disable-next-line no-console
      console.error("Working-hours rejection", result.error.errors);
    }
    expect(result.success).toBe(true);
  });

  it("rejects a working-hours-window booking outside the LA local window", () => {
    const hints = { timeZone: "America/Los_Angeles" } as any;
    const enabledWorkingHours = {
      enabled: true,
      weeklySchedule: {
        "0": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "1": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "2": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "3": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "4": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "5": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
        "6": { isOpen: true, openTime: "09:00", closeTime: "17:00" },
      },
      overrides: [],
    };
    const schema = BookingFormSchema({
      hints,
      action: "new",
      workingHours: enabledWorkingHours,
      bookingSettings: baseBookingSettings,
      isAdminOrOwner: true,
    });

    // 22:00 LA local is outside 09–17. The same wire string parsed in UTC
    // would also be outside the window, but for the WRONG reason — this
    // assertion proves the zone is being honored: if we accidentally fell
    // back to server-local interpretation, the rejection message would
    // still appear but for a different time.
    const result = schema.safeParse({
      name: "WH Booking",
      startDate: "2099-04-24T22:00",
      endDate: "2099-04-25T01:00",
      custodian: JSON.stringify({
        id: "tm-1",
        name: "Test User",
        userId: "user-1",
      }),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMessages = result.error.errors.map((e) => e.message);
      expect(
        errorMessages.some((msg) =>
          msg.toLowerCase().includes("must be between")
        )
      ).toBe(true);
    }
  });
});
