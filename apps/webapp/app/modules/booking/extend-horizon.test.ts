import { describe, expect, it } from "vitest";
import { readClashRefusal, suggestEndBeforeClash } from "./extend-horizon";

describe("suggestEndBeforeClash", () => {
  const timeZone = "Europe/Amsterdam";

  it("keeps the booking's end time on the day before a morning clash", () => {
    const suggested = suggestEndBeforeClash({
      // Ends 10 Nov 18:00 Amsterdam (17:00Z)
      currentEnd: new Date("2026-11-10T17:00:00Z"),
      // Next reservation starts 12 Nov 09:00 Amsterdam (08:00Z)
      clashStart: new Date("2026-11-12T08:00:00Z"),
      timeZone,
    });
    expect(suggested?.toISOString()).toBe("2026-11-11T17:00:00.000Z");
  });

  it("uses the clash day itself when the clash starts after the end time", () => {
    const suggested = suggestEndBeforeClash({
      currentEnd: new Date("2026-11-10T17:00:00Z"),
      // 12 Nov 20:00 Amsterdam (19:00Z)
      clashStart: new Date("2026-11-12T19:00:00Z"),
      timeZone,
    });
    expect(suggested?.toISOString()).toBe("2026-11-12T17:00:00.000Z");
  });

  it("offers nothing when the clash starts before another full day fits", () => {
    expect(
      suggestEndBeforeClash({
        currentEnd: new Date("2026-11-10T17:00:00Z"),
        // 11 Nov 09:00 Amsterdam: the only candidate (11 Nov 18:00) is after it
        clashStart: new Date("2026-11-11T08:00:00Z"),
        timeZone,
      })
    ).toBeNull();
  });

  it("keeps the wall clock across a DST change", () => {
    const suggested = suggestEndBeforeClash({
      // Ends 20 Oct 18:00 CEST (16:00Z)
      currentEnd: new Date("2026-10-20T16:00:00Z"),
      // Clash 2 Nov 09:00 CET (08:00Z), after the clocks went back
      clashStart: new Date("2026-11-02T08:00:00Z"),
      timeZone,
    });
    // 1 Nov 18:00 CET = 17:00Z
    expect(suggested?.toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });
});

describe("readClashRefusal", () => {
  it("reads the typed payload and drops malformed rows", () => {
    expect(
      readClashRefusal({
        clashingBookings: [
          {
            id: "b1",
            name: "Job",
            from: "2026-11-12T08:00:00.000Z",
            items: [{ id: "a1", name: "Cam 1", kind: "asset" }, null, 3],
          },
          { name: "no id" },
        ],
        freeUntil: "2026-11-12T08:00:00.000Z",
      })
    ).toEqual({
      clashingBookings: [
        {
          id: "b1",
          name: "Job",
          from: "2026-11-12T08:00:00.000Z",
          items: [{ id: "a1", name: "Cam 1", kind: "asset" }],
        },
      ],
      freeUntil: "2026-11-12T08:00:00.000Z",
    });
  });

  it("is null for errors that are not clashes", () => {
    expect(readClashRefusal(undefined)).toBeNull();
    expect(readClashRefusal({ userId: "u" })).toBeNull();
    expect(readClashRefusal({ clashingBookings: [] })).toBeNull();
  });
});
