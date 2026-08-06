import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedFormatPrefs } from "~/utils/date-format";

// why: importing the module transitively loads `~/database/db.server`, which
// connects at module load. Mock the db module so the fire-and-forget updateMany
// is observable and no real connection opens under `pnpm webapp:test`.
// vi.hoisted keeps the mock fn defined before the hoisted vi.mock factory runs.
const { updateManyMock } = vi.hoisted(() => ({
  updateManyMock: vi.fn().mockResolvedValue({ count: 1 }),
}));
vi.mock("~/database/db.server", () => ({
  db: { user: { updateMany: updateManyMock } },
}));

import { detectAndPersistFormatPrefs } from "./format-prefs.server";

// Fully-detected prefs to persist — the shape `detectFormatPrefsForPersistence`
// returns when the CH-time-zone cookie IS present.
const detected: DetectedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStart: "MONDAY",
  timeZone: "Europe/London",
};

describe("detectAndPersistFormatPrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes nothing when every pref is already concrete", () => {
    detectAndPersistFormatPrefs(
      "user-1",
      {
        dateFormat: "MM_DD_YYYY",
        timeFormat: "H12",
        weekStart: "SUNDAY",
        timeZone: "UTC",
      },
      detected
    );

    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("backfills each still-null field with its OWN null-guarded write, never the set field", () => {
    detectAndPersistFormatPrefs(
      "user-1",
      {
        dateFormat: "MM_DD_YYYY", // already set — must NOT be overwritten
        timeFormat: null,
        weekStart: null,
        timeZone: null,
      },
      detected
    );

    // One updateMany PER still-null field (3 here), not a single combined write.
    // Each WHERE guards its OWN column so a concurrent explicit set of that
    // column makes the write match zero rows instead of clobbering it with a
    // stale detected value — the core race fix.
    expect(updateManyMock).toHaveBeenCalledTimes(3);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "user-1", timeFormat: null },
      data: { timeFormat: "H24" },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "user-1", weekStart: null },
      data: { weekStart: "MONDAY" },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "user-1", timeZone: null },
      data: { timeZone: "Europe/London" },
    });
    // The already-set field is never written (no call carries a dateFormat).
    const wroteDateFormat = updateManyMock.mock.calls.some(
      ([arg]) => arg?.data && "dateFormat" in arg.data
    );
    expect(wroteDateFormat).toBe(false);
  });

  it("never stamps the timezone when detected.timeZone is null (CH cookie absent)", () => {
    // detectFormatPrefsForPersistence returns timeZone: null when the request
    // lacks the CH-time-zone cookie (first authenticated load / SSO / OAuth).
    // The backfill must leave the column null — so a later request carrying the
    // real cookie fills it — rather than stamping the "UTC" fallback, which the
    // fast-path would then treat as concrete and never correct. The other still-
    // null fields are still backfilled.
    detectAndPersistFormatPrefs(
      "user-1",
      { dateFormat: null, timeFormat: null, weekStart: null, timeZone: null },
      { ...detected, timeZone: null }
    );

    // dateFormat + timeFormat + weekStart written; timeZone deliberately skipped.
    expect(updateManyMock).toHaveBeenCalledTimes(3);
    const wroteTimeZone = updateManyMock.mock.calls.some(
      ([arg]) => arg?.data && "timeZone" in arg.data
    );
    expect(wroteTimeZone).toBe(false);
  });

  it("does not throw when the write rejects (fire-and-forget)", async () => {
    updateManyMock.mockRejectedValueOnce(new Error("db down"));

    expect(() =>
      detectAndPersistFormatPrefs(
        "user-1",
        {
          dateFormat: null,
          timeFormat: null,
          weekStart: null,
          timeZone: null,
        },
        detected
      )
    ).not.toThrow();

    // let the swallowed rejection settle without an unhandled rejection
    await Promise.resolve();
  });
});
