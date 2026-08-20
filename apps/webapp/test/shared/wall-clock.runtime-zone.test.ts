import { wallClockDateInZone, wallClockWireString } from "@shelf/datetime";

// @vitest-environment node

/**
 * How a wall-clock carrier behaves against the RUNTIME zone's own DST.
 *
 * why a separate file that moves the clock: a carrier holds its wall clock in a
 * `Date`'s local fields, so the runtime zone decides which clocks are
 * representable at all. That is invisible to the main suite, which is
 * deliberately runtime-zone-independent and would agree with a broken
 * implementation under CI's UTC.
 *
 * `process.env.TZ` is re-read per `Date` operation, so setting it immediately
 * around a construction works. Setting it once in a hook and expecting later
 * operations to follow does not — pin the zone at the point of use, as
 * `inRuntimeZone` does.
 *
 * @see {@link file://./wall-clock.test.ts} the zone-independent contract
 */

/** Runs `assert` with the process clock moved to `timeZone`, then restores it. */
function inRuntimeZone(timeZone: string, assert: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    assert();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe("carrier day arithmetic across a runtime DST edge", () => {
  it("preserves the wall clock when the calendar field is stepped", () => {
    expect.assertions(1);

    // 2026-03-08 is the PST→PDT spring forward, so that calendar day is 23h.
    inRuntimeZone("America/Los_Angeles", () => {
      const carrier = wallClockDateInZone("2026-03-07T18:00:00Z", "UTC");
      carrier.setDate(carrier.getDate() + 1);

      expect(wallClockWireString(carrier)).toBe("2026-03-08T18:00");
    });
  });

  it("does NOT preserve it when a fixed 24h is added instead", () => {
    expect.assertions(1);

    // The reason both booking screens step the calendar field. Pinned so the
    // shorter-looking `+ 24h` cannot come back unnoticed.
    inRuntimeZone("America/Los_Angeles", () => {
      const carrier = wallClockDateInZone("2026-03-07T18:00:00Z", "UTC");
      const shifted = new Date(carrier.getTime() + 24 * 60 * 60 * 1000);

      expect(wallClockWireString(shifted)).toBe("2026-03-08T19:00");
    });
  });
});

describe("wall clocks the runtime zone skips", () => {
  it("normalises forward by an hour — a known limitation", () => {
    expect.assertions(2);

    // 02:30 does not exist on 2026-03-08 in Los Angeles, so a `Date` cannot
    // carry it and resolves forward. A booking stored as 02:30 UTC therefore
    // re-submits as 03:30 from an LA device even if untouched.
    //
    // Driving the picker with its `timeZoneName` prop instead would remove the
    // device-local hop entirely; that is a different contract, not a patch.
    inRuntimeZone("America/Los_Angeles", () => {
      expect(
        wallClockWireString(wallClockDateInZone("2026-03-08T02:30:00Z", "UTC"))
      ).toBe("2026-03-08T03:30");
    });

    // Same instant, same carried zone, a runtime zone with no gap there: exact.
    inRuntimeZone("UTC", () => {
      expect(
        wallClockWireString(wallClockDateInZone("2026-03-08T02:30:00Z", "UTC"))
      ).toBe("2026-03-08T02:30");
    });
  });
});
