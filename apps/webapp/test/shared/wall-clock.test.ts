import {
  wallClockDateInZone,
  wallClockPartsInZone,
  wallClockWireString,
} from "@shelf/datetime";

// @vitest-environment node

/**
 * The wall-clock carrier contract that the companion's booking pickers rest on.
 *
 * A native date picker can only speak `Date`, and a `Date`'s field accessors
 * answer in the runtime's own zone. To let the picker edit ANOTHER zone's wall
 * clock, `wallClockDateInZone` returns a Date whose local fields spell that
 * zone's clock, and `wallClockWireString` reads them back out.
 *
 * why no `process.env.TZ` juggling: the round trip is deliberately independent
 * of the runtime zone — carrier in, same wall clock out — so the assertions
 * hold identically on a UTC CI box and a JST laptop. A test that needed the
 * clock moved would be asserting something weaker.
 *
 * Every zone-sensitive case passes ONE instant through SEVERAL zones and
 * expects DIFFERENT output. An implementation that ignores `timeZone` cannot
 * satisfy both halves.
 */

describe("wallClockPartsInZone", () => {
  it("reads one instant differently in each zone", () => {
    expect.assertions(3);

    // 2026-08-20T23:30Z — already the 21st in Tokyo, still the 20th in LA.
    const instant = new Date("2026-08-20T23:30:00Z");

    expect(wallClockPartsInZone(instant, "UTC")).toEqual({
      year: 2026,
      month: 8,
      day: 20,
      hour: 23,
      minute: 30,
    });
    expect(wallClockPartsInZone(instant, "Asia/Tokyo")).toEqual({
      year: 2026,
      month: 8,
      day: 21,
      hour: 8,
      minute: 30,
    });
    expect(wallClockPartsInZone(instant, "America/Los_Angeles")).toEqual({
      year: 2026,
      month: 8,
      day: 20,
      hour: 16,
      minute: 30,
    });
  });

  it("reports month as 1-12, not a Date's 0-11", () => {
    expect.assertions(1);

    expect(
      wallClockPartsInZone(new Date("2026-01-15T12:00:00Z"), "UTC").month
    ).toBe(1);
  });

  it("tracks the zone's DST offset rather than a fixed one", () => {
    expect.assertions(2);

    // Los Angeles is UTC-7 in July and UTC-8 in January.
    expect(
      wallClockPartsInZone(
        new Date("2026-07-01T18:00:00Z"),
        "America/Los_Angeles"
      ).hour
    ).toBe(11);
    expect(
      wallClockPartsInZone(
        new Date("2026-01-01T18:00:00Z"),
        "America/Los_Angeles"
      ).hour
    ).toBe(10);
  });

  it("reports midnight as hour 0, never 24", () => {
    expect.assertions(2);

    // `Intl` can answer "24" for midnight under an h24 hour cycle, which would
    // make the wire string unparseable. Pinned for both zone directions.
    expect(wallClockPartsInZone("2026-08-20T00:00:00Z", "UTC").hour).toBe(0);
    expect(
      wallClockPartsInZone("2026-08-20T15:00:00Z", "Asia/Tokyo").hour
    ).toBe(0);
  });

  it("accepts an ISO string as well as a Date", () => {
    expect.assertions(1);

    expect(wallClockPartsInZone("2026-08-20T23:30:00Z", "Asia/Tokyo")).toEqual(
      wallClockPartsInZone(new Date("2026-08-20T23:30:00Z"), "Asia/Tokyo")
    );
  });
});

describe("wallClockDateInZone → wallClockWireString round trip", () => {
  it("returns the wall clock of the requested zone, not of the runtime", () => {
    expect.assertions(3);

    const instant = new Date("2026-08-20T23:30:00Z");

    expect(wallClockWireString(wallClockDateInZone(instant, "UTC"))).toBe(
      "2026-08-20T23:30"
    );
    expect(
      wallClockWireString(wallClockDateInZone(instant, "Asia/Tokyo"))
    ).toBe("2026-08-21T08:30");
    expect(
      wallClockWireString(wallClockDateInZone(instant, "America/Los_Angeles"))
    ).toBe("2026-08-20T16:30");
  });

  it("pads every field to two digits and emits no seconds", () => {
    expect.assertions(1);

    expect(
      wallClockWireString(wallClockDateInZone("2026-01-02T03:04:05Z", "UTC"))
    ).toBe("2026-01-02T03:04");
  });

  it("steps whole calendar days of the carried zone, not of the runtime", () => {
    expect.assertions(2);

    // 23:30Z is 08:30 the NEXT day in Tokyo, so +1 day lands on the 22nd there
    // while the same step from the UTC reading lands on the 21st.
    const tokyo = wallClockDateInZone("2026-08-20T23:30:00Z", "Asia/Tokyo");
    tokyo.setDate(tokyo.getDate() + 1);
    expect(wallClockWireString(tokyo)).toBe("2026-08-22T08:30");

    const utc = wallClockDateInZone("2026-08-20T23:30:00Z", "UTC");
    utc.setDate(utc.getDate() + 1);
    expect(wallClockWireString(utc)).toBe("2026-08-21T23:30");
  });

  it("keeps the wall clock fixed across the carried zone's DST change", () => {
    expect.assertions(2);

    // Both instants are 18:00Z; LA reads 11:00 in July and 10:00 in January.
    expect(
      wallClockWireString(
        wallClockDateInZone("2026-07-01T18:00:00Z", "America/Los_Angeles")
      )
    ).toBe("2026-07-01T11:00");
    expect(
      wallClockWireString(
        wallClockDateInZone("2026-01-01T18:00:00Z", "America/Los_Angeles")
      )
    ).toBe("2026-01-01T10:00");
  });
});
