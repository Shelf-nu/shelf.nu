// @vitest-environment node
import { ReminderRecurrenceUnit } from "@prisma/client";
import {
  describeRecurrence,
  getNextOccurrence,
  isRecurringReminder,
  repeatValueFromRecurrence,
  resolveRecurrenceZone,
} from "./recurrence";

describe("getNextOccurrence", () => {
  it("advances a daily series by one day", () => {
    const base = new Date("2026-07-10T09:00:00.000Z");
    const next = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.DAY,
      interval: 1,
      timezone: "UTC",
      now: new Date("2026-07-10T09:00:01.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-07-11T09:00:00.000Z");
  });

  it("keeps wall-clock time across spring-forward DST (Europe/Berlin)", () => {
    // 2026-03-28 09:00 CET (+01:00) = 08:00Z; next day is CEST (+02:00)
    const base = new Date("2026-03-28T08:00:00.000Z");
    const next = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.DAY,
      interval: 1,
      timezone: "Europe/Berlin",
      now: new Date("2026-03-28T08:00:01.000Z"),
    });
    // 09:00 wall-clock in CEST = 07:00Z — the UTC instant shifts, the
    // local time does not
    expect(next?.toISOString()).toBe("2026-03-29T07:00:00.000Z");
  });

  it("keeps wall-clock time across fall-back DST (Europe/Berlin)", () => {
    // 2026-10-24 09:00 CEST (+02:00) = 07:00Z; 2026-10-25 is CET (+01:00)
    const base = new Date("2026-10-24T07:00:00.000Z");
    const next = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.DAY,
      interval: 1,
      timezone: "Europe/Berlin",
      now: new Date("2026-10-24T07:00:01.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("clamps month-end anniversaries (Jan 31 -> Feb 28, then stays on the 28th)", () => {
    const base = new Date("2026-01-31T10:00:00.000Z");
    const feb = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.MONTH,
      interval: 1,
      timezone: "UTC",
      now: new Date("2026-01-31T10:00:01.000Z"),
    });
    expect(feb?.toISOString()).toBe("2026-02-28T10:00:00.000Z");

    // The advanced date is the new anchor — intended v1 behavior
    const mar = getNextOccurrence({
      base: feb!,
      unit: ReminderRecurrenceUnit.MONTH,
      interval: 1,
      timezone: "UTC",
      now: new Date("2026-02-28T10:00:01.000Z"),
    });
    expect(mar?.toISOString()).toBe("2026-03-28T10:00:00.000Z");
  });

  it("supports multi-unit intervals (every 2 weeks, every 3 months, yearly)", () => {
    const base = new Date("2026-07-01T08:00:00.000Z");
    const now = new Date("2026-07-01T08:00:01.000Z");

    expect(
      getNextOccurrence({
        base,
        unit: ReminderRecurrenceUnit.WEEK,
        interval: 2,
        timezone: "UTC",
        now,
      })?.toISOString()
    ).toBe("2026-07-15T08:00:00.000Z");

    expect(
      getNextOccurrence({
        base,
        unit: ReminderRecurrenceUnit.MONTH,
        interval: 3,
        timezone: "UTC",
        now,
      })?.toISOString()
    ).toBe("2026-10-01T08:00:00.000Z");

    expect(
      getNextOccurrence({
        base,
        unit: ReminderRecurrenceUnit.YEAR,
        interval: 1,
        timezone: "UTC",
        now,
      })?.toISOString()
    ).toBe("2027-07-01T08:00:00.000Z");
  });

  it("skips occurrences missed during downtime (catch-up policy: no burst)", () => {
    const base = new Date("2026-01-01T09:00:00.000Z");
    const next = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.DAY,
      interval: 1,
      timezone: "UTC",
      now: new Date("2026-01-10T12:00:00.000Z"),
    });
    // Jan 2..10 are skipped; the first occurrence strictly after now wins
    expect(next?.toISOString()).toBe("2026-01-11T09:00:00.000Z");
  });

  it("returns a strictly-future occurrence when now lands exactly on one", () => {
    const base = new Date("2026-07-10T09:00:00.000Z");
    const next = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.DAY,
      interval: 1,
      timezone: "UTC",
      now: new Date("2026-07-11T09:00:00.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-07-12T09:00:00.000Z");
  });

  it("ends the series when the next occurrence would exceed endsAt", () => {
    const base = new Date("2026-01-01T09:00:00.000Z");
    const endsAt = new Date("2026-02-15T23:59:59.999Z");

    const feb = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.MONTH,
      interval: 1,
      timezone: "UTC",
      endsAt,
      now: new Date("2026-01-01T09:00:01.000Z"),
    });
    expect(feb?.toISOString()).toBe("2026-02-01T09:00:00.000Z");

    const march = getNextOccurrence({
      base: feb!,
      unit: ReminderRecurrenceUnit.MONTH,
      interval: 1,
      timezone: "UTC",
      endsAt,
      now: new Date("2026-02-01T09:00:01.000Z"),
    });
    expect(march).toBeNull();
  });

  it("falls back to UTC for an invalid stored timezone instead of failing", () => {
    const base = new Date("2026-07-10T09:00:00.000Z");
    const next = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.DAY,
      interval: 1,
      timezone: "Not/AZone",
      now: new Date("2026-07-10T09:00:01.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-07-11T09:00:00.000Z");
  });

  it("clamps interval below 1 to 1 (no infinite/backwards loop)", () => {
    const base = new Date("2026-07-10T09:00:00.000Z");
    const next = getNextOccurrence({
      base,
      unit: ReminderRecurrenceUnit.DAY,
      interval: 0,
      timezone: "UTC",
      now: new Date("2026-07-10T09:00:01.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-07-11T09:00:00.000Z");
  });
});

describe("recurrence helpers", () => {
  it("identifies recurring reminders", () => {
    expect(
      isRecurringReminder({ recurrenceUnit: null, recurrenceInterval: null })
    ).toBe(false);
    expect(
      isRecurringReminder({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 3,
      })
    ).toBe(true);
  });

  it("maps stored (unit, interval) back to a dialog preset", () => {
    expect(
      repeatValueFromRecurrence({
        recurrenceUnit: ReminderRecurrenceUnit.WEEK,
        recurrenceInterval: 2,
      })
    ).toBe("biweekly");
    expect(
      repeatValueFromRecurrence({
        recurrenceUnit: null,
        recurrenceInterval: null,
      })
    ).toBe("never");
  });

  it("describes cadences for the UI and emails", () => {
    expect(
      describeRecurrence({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 3,
      })
    ).toBe("Every 3 months");
    expect(
      describeRecurrence({
        recurrenceUnit: ReminderRecurrenceUnit.MONTH,
        recurrenceInterval: 5, // non-preset data falls back to a generated label
      })
    ).toBe("Every 5 months");
    expect(
      describeRecurrence({ recurrenceUnit: null, recurrenceInterval: null })
    ).toBeNull();
  });

  it("validates stored zones", () => {
    expect(resolveRecurrenceZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(resolveRecurrenceZone("Not/AZone")).toBe("UTC");
    expect(resolveRecurrenceZone(null)).toBe("UTC");
  });
});
