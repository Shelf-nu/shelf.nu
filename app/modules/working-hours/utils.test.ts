import { parseISO } from "date-fns";

import type { WorkingHoursData, WeeklyScheduleJson } from "./types";
import {
  calculateEffectiveEndDate,
  calculateBusinessHoursDuration,
  getBookingDefaultStartEndTimes,
  normalizeWorkingHoursForValidation,
} from "./utils";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock date-fns to control time in tests
vitest.mock("~/utils/date-fns", () => ({
  dateForDateTimeInputValue: vitest.fn(
    (date: Date) => date.toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm format
  ),
}));

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
          date: new Date("2025-07-25T00:00:00Z"),
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: null,
        },
      ],
    };

    const result = normalizeWorkingHoursForValidation(rawWorkingHours);

    expect(result?.overrides[0].date).toBe("2025-07-25T00:00:00.000Z");
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

describe("calculateEffectiveEndDate", () => {
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

  it("should return original end date when not skipping closed days", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday
    const endDate = new Date("2025-07-28T17:00:00Z"); // Monday

    const result = calculateEffectiveEndDate(
      startDate,
      endDate,
      mockWorkingHours,
      false // skipClosedDays = false
    );

    expect(result).toBe(endDate);
  });

  it("should return original end date when working hours disabled", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-25T15:00:00Z");
    const endDate = new Date("2025-07-28T17:00:00Z");
    const disabledWorkingHours = { ...mockWorkingHours, enabled: false };

    const result = calculateEffectiveEndDate(
      startDate,
      endDate,
      disabledWorkingHours,
      true // skipClosedDays = true, but working hours disabled
    );

    expect(result).toBe(endDate);
  });

  it("should return original end date when no working hours data", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-25T15:00:00Z");
    const endDate = new Date("2025-07-28T17:00:00Z");

    const result = calculateEffectiveEndDate(
      startDate,
      endDate,
      null, // no working hours
      true
    );

    expect(result).toBe(endDate);
  });

  it("should extend end date by 2 days when skipping weekend", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday 3 PM
    const endDate = new Date("2025-07-28T17:00:00Z"); // Monday 5 PM

    const result = calculateEffectiveEndDate(
      startDate,
      endDate,
      mockWorkingHours,
      true
    );

    // Should extend by 2 days (Saturday + Sunday)
    const expected = new Date("2025-07-30T17:00:00Z"); // Wednesday 5 PM
    expect(result).toEqual(expected);
  });

  it("should handle date-specific overrides", () => {
    expect.assertions(1);

    const workingHoursWithOverride: WorkingHoursData = {
      ...mockWorkingHours,
      overrides: [
        {
          id: "holiday",
          date: "2025-07-28T00:00:00Z", // Monday is now closed (holiday)
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: "Holiday",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          workingHoursId: "working-hours-1",
        },
      ],
    };

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday
    const endDate = new Date("2025-07-29T17:00:00Z"); // Tuesday

    const result = calculateEffectiveEndDate(
      startDate,
      endDate,
      workingHoursWithOverride,
      true
    );

    // Should extend by 3 days (Saturday + Sunday + Monday holiday)
    const expected = new Date("2025-08-01T17:00:00Z"); // Friday
    expect(result).toEqual(expected);
  });

  it("should handle overrides that open normally closed days", () => {
    expect.assertions(1);

    const workingHoursWithOverride: WorkingHoursData = {
      ...mockWorkingHours,
      overrides: [
        {
          id: "special",
          date: "2025-07-26T00:00:00Z", // Saturday is now open (special day)
          isOpen: true,
          openTime: "10:00",
          closeTime: "16:00",
          reason: "Special event",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          workingHoursId: "working-hours-1",
        },
      ],
    };

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday
    const endDate = new Date("2025-07-28T17:00:00Z"); // Monday

    const result = calculateEffectiveEndDate(
      startDate,
      endDate,
      workingHoursWithOverride,
      true
    );

    // Should extend by 1 day (only Sunday, Saturday is now open)
    const expected = new Date("2025-07-29T17:00:00Z"); // Tuesday
    expect(result).toEqual(expected);
  });

  it("should handle booking within same day", () => {
    expect.assertions(1);

    const startDate = new Date("2025-07-28T10:00:00Z"); // Monday 10 AM
    const endDate = new Date("2025-07-28T15:00:00Z"); // Monday 3 PM

    const result = calculateEffectiveEndDate(
      startDate,
      endDate,
      mockWorkingHours,
      true
    );

    // No closed days in between, should return original
    expect(result).toEqual(endDate);
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
      mockWorkingHours
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
      mockWorkingHours
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
      mockWorkingHours
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
      mockWorkingHours
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
          date: "2025-07-28T00:00:00Z", // Monday is closed (holiday)
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: "Holiday",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          workingHoursId: "working-hours-1",
        },
      ],
    };

    const startDate = new Date("2025-07-25T15:00:00Z"); // Friday 3 PM
    const endDate = new Date("2025-07-29T17:00:00Z"); // Tuesday 5 PM

    const result = calculateBusinessHoursDuration(
      startDate,
      endDate,
      workingHoursWithHoliday
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
      mockWorkingHours
    );

    // Total: 71 hours, Closed: 48 hours (full weekend), Effective: 23 hours
    expect(result).toBe(23);
  });
});

describe("getBookingDefaultStartEndTimes", () => {
  beforeEach(() => {
    // Mock current time to Friday, July 25, 2025 at 2 PM
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

    const result = getBookingDefaultStartEndTimes(disabledWorkingHours, 2);

    // Should use original logic with 2-hour buffer
    expect(result.startDate).toBe("2025-07-25T16:00"); // Current + 2 hours
  });

  it("should use fallback logic when no working hours data", () => {
    expect.assertions(1);

    const result = getBookingDefaultStartEndTimes(null, 1);

    // Should use original logic with 1-hour buffer
    expect(result.startDate).toBe("2025-07-25T15:00"); // Current + 1 hour
  });

  it("should handle current time within working hours", () => {
    expect.assertions(2);

    const result = getBookingDefaultStartEndTimes(mockWorkingHours, 0);

    // Function finds next available working time (6 AM UTC = 9 AM local)
    expect(result.startDate).toBe("2025-07-28T06:00"); // Next working day 9 AM local (6 AM UTC)
    expect(result.endDate).toBe("2025-07-28T14:00"); // End of working day 5 PM local (2 PM UTC)
  });

  it("should handle buffer time within working hours", () => {
    expect.assertions(2);

    const result = getBookingDefaultStartEndTimes(mockWorkingHours, 2);

    expect(result.startDate).toBe("2025-07-28T06:00"); // Next working day 9 AM local (6 AM UTC)
    expect(result.endDate).toBe("2025-07-28T14:00"); // End of working day 5 PM local (2 PM UTC)
  });

  it("should find next working day when outside hours", () => {
    expect.assertions(2);

    // Mock time to Saturday (closed day)
    vitest.setSystemTime(new Date("2025-07-26T14:00:00Z"));

    const result = getBookingDefaultStartEndTimes(mockWorkingHours, 0);

    expect(result.startDate).toBe("2025-07-28T06:00"); // Next Monday 9 AM local (6 AM UTC)
    expect(result.endDate).toBe("2025-07-28T14:00"); // Next Monday 5 PM local (2 PM UTC)
  });

  it("should handle buffer time that extends past working hours", () => {
    expect.assertions(2);

    // Mock time to late Friday afternoon
    vitest.setSystemTime(new Date("2025-07-25T16:30:00Z"));

    const result = getBookingDefaultStartEndTimes(mockWorkingHours, 2);

    // Buffer would put us at 6:30 PM, past closing, so use next working day
    expect(result.startDate).toBe("2025-07-28T06:00"); // Next Monday 9 AM local (6 AM UTC)
    expect(result.endDate).toBe("2025-07-28T14:00"); // Next Monday 5 PM local (2 PM UTC)
  });

  it("should handle date-specific overrides", () => {
    expect.assertions(2);

    const workingHoursWithOverride: WorkingHoursData = {
      ...mockWorkingHours,
      overrides: [
        {
          id: "today-closed",
          date: "2025-07-25T00:00:00Z", // Today (Friday) is closed
          isOpen: false,
          openTime: null,
          closeTime: null,
          reason: "Company event",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          workingHoursId: "working-hours-1",
        },
      ],
    };

    const result = getBookingDefaultStartEndTimes(workingHoursWithOverride, 0);

    expect(result.startDate).toBe("2025-07-28T06:00"); // Next Monday 9 AM local (6 AM UTC)
    expect(result.endDate).toBe("2025-07-28T14:00"); // Next Monday 5 PM local (2 PM UTC)
  });
});
