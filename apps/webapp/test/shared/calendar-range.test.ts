import {
  calendarDayKey,
  calendarDayKeyToDate,
  calendarDaysCovered,
  calendarMonthWindow,
} from "@shelf/datetime";

// @vitest-environment node

/**
 * Day-range maths behind the companion's booking calendar.
 *
 * Lives here because `@shelf/datetime` has no runner of its own and the webapp
 * already depends on the package; a React Native runtime is not needed to
 * exercise pure date logic.
 */
describe("calendarDayKey", () => {
  it("keys a date by its LOCAL day, not its UTC day", () => {
    // why: `toISOString().slice(0,10)` is the tempting one-liner and it is
    // wrong. A late-evening booking would jump a day for anyone east of UTC,
    // and its band would paint on the wrong square.
    const lateEvening = new Date(2026, 7, 7, 23, 30); // 7 Aug, local
    expect(calendarDayKey(lateEvening)).toBe("2026-08-07");
  });

  it("zero pads single digit months and days", () => {
    expect(calendarDayKey(new Date(2026, 0, 3))).toBe("2026-01-03");
  });

  it("keys the first and last day of a year correctly", () => {
    expect(calendarDayKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(calendarDayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

/** Local-time ISO, so these tests do not depend on the machine's zone. */
const iso = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h).toISOString();

describe("calendarDaysCovered", () => {
  it("returns the single day for a booking that starts and ends the same day", () => {
    expect(
      calendarDaysCovered(iso(2026, 8, 7, 9), iso(2026, 8, 7, 17))
    ).toEqual(["2026-08-07"]);
  });

  it("returns every day in between, so a job draws as one run", () => {
    // why: this is the whole reason the calendar is not a scatter of dots — a
    // five day job has to read as one continuous band.
    expect(calendarDaysCovered(iso(2026, 8, 3), iso(2026, 8, 7))).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  it("crosses a month boundary", () => {
    // why: the August calendar must still paint a job that began in July.
    expect(calendarDaysCovered(iso(2026, 7, 30), iso(2026, 8, 2))).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(calendarDaysCovered(iso(2026, 12, 31), iso(2027, 1, 2))).toEqual([
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("handles a leap day", () => {
    expect(calendarDaysCovered(iso(2028, 2, 28), iso(2028, 3, 1))).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("counts a range by calendar days, not elapsed hours", () => {
    // 23:00 to 01:00 is two hours but touches two squares, and both must be
    // painted or the band breaks.
    const keys = calendarDaysCovered(iso(2026, 8, 7, 23), iso(2026, 8, 8, 1));
    expect(keys).toEqual(["2026-08-07", "2026-08-08"]);
  });

  it("returns nothing for a reversed range rather than looping", () => {
    expect(calendarDaysCovered(iso(2026, 8, 10), iso(2026, 8, 1))).toEqual([]);
  });

  it("returns nothing for unparseable input", () => {
    expect(calendarDaysCovered("not-a-date", iso(2026, 8, 1))).toEqual([]);
    expect(calendarDaysCovered(iso(2026, 8, 1), "")).toEqual([]);
  });

  it("caps an absurd range instead of enumerating forever", () => {
    // why: the window is client supplied and bad data should degrade, not hang
    // the screen.
    const keys = calendarDaysCovered(iso(2000, 1, 1), iso(2030, 1, 1));
    expect(keys.length).toBe(400);
  });
});

describe("calendarDayKeyToDate", () => {
  it("parses a day key as a LOCAL date, not a UTC instant", () => {
    // why this exists at all: `new Date("2026-09-01")` is the date-only form,
    // which the spec parses as UTC midnight. Anywhere west of UTC that Date is
    // 31 August locally, so a calendar reading getMonth() off it asks the
    // server for August while showing September.
    const first = calendarDayKeyToDate("2026-09-01");
    expect(first.getFullYear()).toBe(2026);
    expect(first.getMonth()).toBe(8); // September, zero indexed
    expect(first.getDate()).toBe(1);
    expect(first.getHours()).toBe(0);
  });

  it("round-trips with calendarDayKey", () => {
    expect(calendarDayKey(calendarDayKeyToDate("2026-02-28"))).toBe(
      "2026-02-28"
    );
  });

  it("returns an invalid date for a malformed key rather than guessing", () => {
    expect(Number.isNaN(calendarDayKeyToDate("2026-9-1").getTime())).toBe(true);
    expect(Number.isNaN(calendarDayKeyToDate("").getTime())).toBe(true);
  });
});

describe("calendarDaysCovered, clipped to a window", () => {
  const window = {
    from: new Date(2026, 7, 1),
    to: new Date(2026, 7, 31),
  };

  it("still marks a booking longer than the enumeration cap", () => {
    // The regression this guards: the cap counts from the booking's own start,
    // so a two-year booking ran out of keys long before August and vanished
    // from a month it genuinely occupies.
    const keys = calendarDaysCovered(iso(2024, 1, 1), iso(2027, 1, 1), window);
    expect(keys[0]).toBe("2026-08-01");
    expect(keys[keys.length - 1]).toBe("2026-08-31");
    expect(keys.length).toBe(31);
  });

  it("does not widen a booking that sits inside the window", () => {
    const keys = calendarDaysCovered(
      iso(2026, 8, 10),
      iso(2026, 8, 12),
      window
    );
    expect(keys).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("returns nothing for a booking outside the window", () => {
    expect(
      calendarDaysCovered(iso(2026, 6, 1), iso(2026, 6, 5), window)
    ).toEqual([]);
  });
});

describe("calendarMonthWindow", () => {
  it("covers the month plus a week either side", () => {
    const { start, end } = calendarMonthWindow("2026-08-14");
    expect(calendarDayKey(start)).toBe("2026-07-25"); // 1 Aug minus 7
    expect(calendarDayKey(end)).toBe("2026-09-07"); // 31 Aug plus 7
  });

  it("ends at the last instant of the final day, not its midnight", () => {
    // The endpoint documents an inclusive window and filters on `from <= end`.
    // With a midnight bound, a booking starting at 10:00 on the last day of the
    // window sorted as after it and was dropped.
    const { end } = calendarMonthWindow("2026-08-14");
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);

    const lateThatDay = new Date(2026, 8, 7, 10, 0);
    expect(lateThatDay <= end).toBe(true);
  });

  it("reads the month locally, so it does not slip west of UTC", () => {
    // `new Date("2026-09-01")` is UTC midnight, which is 31 August in Los
    // Angeles - the window would have been August's while September showed.
    const { start } = calendarMonthWindow("2026-09-01");
    expect(calendarDayKey(start)).toBe("2026-08-25"); // 1 Sep minus 7
  });
});
