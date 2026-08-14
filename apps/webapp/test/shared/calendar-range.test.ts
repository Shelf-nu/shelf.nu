import { calendarDayKey, calendarDaysCovered } from "@shelf/datetime";

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

describe("calendarDaysCovered", () => {
  /** Local-time ISO, so these tests do not depend on the machine's zone. */
  const iso = (y: number, m: number, d: number, h = 12) =>
    new Date(y, m - 1, d, h).toISOString();

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
