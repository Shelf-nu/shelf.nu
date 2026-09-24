import {
  addDaysInZone,
  instantFromWallClockInZone,
  wallClockOnDayInZone,
  wallClockPartsInZone,
  wallClockWireInZone,
} from "@shelf/datetime";

// @vitest-environment node

/**
 * The wall-clock primitives must not depend on the zone the code runs in.
 *
 * This is the property the booking pickers need and the one that is easiest to
 * lose: any `new Date(y, m, d, h)` or `getHours()` reaches for the runtime zone,
 * which is the device in the companion and UTC on the server. A helper that does
 * so answers differently on a Los Angeles phone than on CI for the same booking,
 * and the main suite cannot see it — that suite runs in one zone, where a
 * runtime-dependent implementation and a correct one agree exactly.
 *
 * So every case here runs the SAME call under three runtime zones and asserts
 * ONE answer. Add cases in that shape; a single-zone assertion belongs in
 * wall-clock.test.ts instead.
 *
 * `process.env.TZ` is re-read per `Date` operation, so setting it around a call
 * works. Setting it once in a hook and expecting later operations to follow does
 * not — pin it at the point of use, as `inEachRuntimeZone` does.
 *
 * @see {@link file://./wall-clock.test.ts} the per-zone contract
 */

const RUNTIME_ZONES = ["UTC", "America/Los_Angeles", "Asia/Tokyo"];

/** Runs `compute` once per runtime zone and returns the distinct results. */
function inEachRuntimeZone(compute: () => string): string[] {
  const previous = process.env.TZ;
  try {
    return [
      ...new Set(
        RUNTIME_ZONES.map((zone) => {
          process.env.TZ = zone;
          return compute();
        })
      ),
    ];
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe("runtime-zone independence", () => {
  it("reads an instant's wall clock identically wherever it runs", () => {
    expect.assertions(1);

    expect(
      inEachRuntimeZone(() =>
        JSON.stringify(wallClockPartsInZone("2026-08-20T23:30:00Z", "UTC"))
      )
    ).toHaveLength(1);
  });

  it("writes the wire string identically wherever it runs", () => {
    expect.assertions(1);

    expect(
      inEachRuntimeZone(() =>
        wallClockWireInZone("2026-08-20T23:30:00Z", "Europe/Amsterdam")
      )
    ).toEqual(["2026-08-21T01:30"]);
  });

  it("locates a wall clock at one instant wherever it runs", () => {
    expect.assertions(1);

    // A clock in the RUNTIME zone's spring-forward gap. Assembling it from a
    // runtime-local `Date` normalises it an hour, so this is the case that
    // separates a zone-solved implementation from a device-local one: under
    // `America/Los_Angeles` a local-fields build answers 03:30 here.
    expect(
      inEachRuntimeZone(() =>
        wallClockWireInZone(
          instantFromWallClockInZone(
            { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
            "UTC"
          ),
          "UTC"
        )
      )
    ).toEqual(["2026-03-08T02:30"]);
  });

  it("steps a calendar day identically wherever it runs", () => {
    expect.assertions(1);

    // The step crosses the RUNTIME zone's DST boundary as well as the carried
    // zone's, so a runtime-local implementation drifts under Los Angeles only.
    expect(
      inEachRuntimeZone(() =>
        wallClockWireInZone(
          addDaysInZone("2026-03-07T18:00:00Z", 1, "America/Los_Angeles"),
          "America/Los_Angeles"
        )
      )
    ).toEqual(["2026-03-08T10:00"]);
  });

  it("resolves a form default identically wherever it runs", () => {
    expect.assertions(1);

    // 23:00Z is already tomorrow in Tokyo and still today in Los Angeles, so a
    // default anchored to the runtime's calendar day lands on the wrong date.
    expect(
      inEachRuntimeZone(() =>
        wallClockWireInZone(
          wallClockOnDayInZone(
            "2026-08-20T23:00:00Z",
            1,
            9,
            0,
            "Europe/Amsterdam"
          ),
          "Europe/Amsterdam"
        )
      )
    ).toEqual(["2026-08-22T09:00"]);
  });
});
