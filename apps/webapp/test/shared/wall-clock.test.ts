import {
  addDaysInZone,
  instantFromWallClockInZone,
  wallClockOnDayInZone,
  wallClockPartsInZone,
  wallClockWireInZone,
} from "@shelf/datetime";

// @vitest-environment node

/**
 * The zone-aware wall-clock primitives the booking pickers rest on.
 *
 * A booking is stored as an instant but chosen, shown and submitted as a wall
 * clock in the acting user's preference zone. These helpers are the only places
 * that cross between the two, so every rule about which zone decides a calendar
 * day, an hour, or a day-step lives here.
 *
 * Every zone-sensitive case passes ONE instant through SEVERAL zones and
 * expects DIFFERENT output, so an implementation that ignores `timeZone` cannot
 * satisfy both halves. Keep that shape when adding cases: two zones agreeing
 * proves nothing.
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

  it("reports midnight as hour 0, never 24", () => {
    expect.assertions(2);

    // `Intl` can answer "24" for midnight under an h24 hour cycle, which would
    // make the wire string unparseable. Pinned for both zone directions.
    expect(wallClockPartsInZone("2026-08-20T00:00:00Z", "UTC").hour).toBe(0);
    expect(
      wallClockPartsInZone("2026-08-20T15:00:00Z", "Asia/Tokyo").hour
    ).toBe(0);
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

  it("accepts an ISO string as well as a Date", () => {
    expect.assertions(1);

    expect(wallClockPartsInZone("2026-08-20T23:30:00Z", "Asia/Tokyo")).toEqual(
      wallClockPartsInZone(new Date("2026-08-20T23:30:00Z"), "Asia/Tokyo")
    );
  });
});

describe("wallClockWireInZone", () => {
  it("writes the wall clock of the requested zone", () => {
    expect.assertions(3);

    const instant = new Date("2026-08-20T23:30:00Z");

    expect(wallClockWireInZone(instant, "UTC")).toBe("2026-08-20T23:30");
    expect(wallClockWireInZone(instant, "Asia/Tokyo")).toBe("2026-08-21T08:30");
    expect(wallClockWireInZone(instant, "America/Los_Angeles")).toBe(
      "2026-08-20T16:30"
    );
  });

  it("pads every field to two digits and emits no seconds", () => {
    expect.assertions(1);

    expect(wallClockWireInZone("2026-01-02T03:04:05Z", "UTC")).toBe(
      "2026-01-02T03:04"
    );
  });
});

describe("instantFromWallClockInZone", () => {
  it("round-trips against wallClockPartsInZone in every zone", () => {
    expect.assertions(4);

    // Includes a whole-hour, a half-hour (+05:45) and a DST-observing zone, so
    // a solver that assumes whole-hour offsets cannot pass.
    for (const zone of [
      "UTC",
      "Asia/Tokyo",
      "Asia/Kathmandu",
      "America/Los_Angeles",
    ]) {
      const instant = "2026-07-04T23:30:00Z";
      const parts = wallClockPartsInZone(instant, zone);

      expect(
        wallClockWireInZone(instantFromWallClockInZone(parts, zone), zone)
      ).toBe(wallClockWireInZone(instant, zone));
    }
  });

  it("locates the same wall clock at a different instant per zone", () => {
    expect.assertions(1);

    const nineAm = { year: 2026, month: 8, day: 20, hour: 9, minute: 0 };

    expect(
      instantFromWallClockInZone(nineAm, "Asia/Tokyo").getTime()
    ).toBeLessThan(
      instantFromWallClockInZone(nineAm, "America/Los_Angeles").getTime()
    );
  });

  it("resolves a clock the zone repeats to the first of its two instants", () => {
    expect.assertions(2);

    // 2026-11-01 in Los Angeles runs 01:00-02:00 twice (PDT then PST). Picking
    // the first keeps the mapping total and monotonic, so a booking made during
    // the repeat does not jump an hour later on the next save.
    const repeated = { year: 2026, month: 11, day: 1, hour: 1, minute: 30 };
    const resolved = instantFromWallClockInZone(
      repeated,
      "America/Los_Angeles"
    );

    expect(resolved.toISOString()).toBe("2026-11-01T08:30:00.000Z");
    expect(wallClockWireInZone(resolved, "America/Los_Angeles")).toBe(
      "2026-11-01T01:30"
    );
  });

  it("resolves a clock the zone skips to just after the transition", () => {
    expect.assertions(1);

    // 02:30 does not exist in Los Angeles on 2026-03-08 (02:00 → 03:00). It has
    // no instant, so it cannot round-trip; resolving forward is the defined
    // answer rather than a throw.
    const skipped = { year: 2026, month: 3, day: 8, hour: 2, minute: 30 };

    expect(
      wallClockWireInZone(
        instantFromWallClockInZone(skipped, "America/Los_Angeles"),
        "America/Los_Angeles"
      )
    ).toBe("2026-03-08T03:30");
  });
});

describe("addDaysInZone", () => {
  it("keeps the wall clock across the zone's DST boundary", () => {
    expect.assertions(2);

    // 2026-03-08 is the spring forward in Los Angeles, so that calendar day is
    // 23 hours long. The clock must not move with it.
    const dayBefore = "2026-03-07T18:00:00Z"; // 10:00 in Los Angeles
    const stepped = addDaysInZone(dayBefore, 1, "America/Los_Angeles");

    expect(wallClockWireInZone(stepped, "America/Los_Angeles")).toBe(
      "2026-03-08T10:00"
    );

    // The elapsed-time alternative this exists to prevent.
    const naive = new Date(new Date(dayBefore).getTime() + 24 * 60 * 60 * 1000);
    expect(wallClockWireInZone(naive, "America/Los_Angeles")).toBe(
      "2026-03-08T11:00"
    );
  });

  it("rolls the month and the year", () => {
    expect.assertions(2);

    expect(
      wallClockWireInZone(
        addDaysInZone("2026-01-31T12:00:00Z", 1, "UTC"),
        "UTC"
      )
    ).toBe("2026-02-01T12:00");
    expect(
      wallClockWireInZone(
        addDaysInZone("2026-12-31T12:00:00Z", 1, "UTC"),
        "UTC"
      )
    ).toBe("2027-01-01T12:00");
  });

  it("counts the day in the given zone, not in UTC", () => {
    expect.assertions(2);

    // 23:00Z is already tomorrow in Tokyo, so +1 lands two UTC days out.
    const instant = "2026-08-20T23:00:00Z";

    expect(wallClockWireInZone(addDaysInZone(instant, 1, "UTC"), "UTC")).toBe(
      "2026-08-21T23:00"
    );
    expect(
      wallClockWireInZone(addDaysInZone(instant, 1, "Asia/Tokyo"), "Asia/Tokyo")
    ).toBe("2026-08-22T08:00");
  });
});

describe("wallClockOnDayInZone", () => {
  it("resolves tomorrow's opening hour in the given zone", () => {
    expect.assertions(2);

    // The same instant is a different calendar day in the two zones, so
    // "tomorrow at 09:00" is a different day in each.
    const now = "2026-08-20T23:00:00Z";

    expect(
      wallClockWireInZone(
        wallClockOnDayInZone(now, 1, 9, 0, "America/Los_Angeles"),
        "America/Los_Angeles"
      )
    ).toBe("2026-08-21T09:00");
    expect(
      wallClockWireInZone(
        wallClockOnDayInZone(now, 1, 9, 0, "Asia/Tokyo"),
        "Asia/Tokyo"
      )
    ).toBe("2026-08-22T09:00");
  });
});
