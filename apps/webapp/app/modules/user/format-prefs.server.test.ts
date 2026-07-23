import { beforeEach, describe, expect, it, vi } from "vitest";

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

// why: pin detection so the test asserts the write shape (not Phase-2 detection
// logic, which is covered by date-format.test.ts).
vi.mock("~/utils/date-format", () => ({
  detectFormatPrefsFromHints: vi.fn(() => ({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStart: "MONDAY",
    timeZone: "Europe/London",
  })),
}));

import { detectAndPersistFormatPrefs } from "./format-prefs.server";

const hints = { locale: "en-GB", timeZone: "Europe/London" };

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
      hints
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
      hints
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
        hints
      )
    ).not.toThrow();

    // let the swallowed rejection settle without an unhandled rejection
    await Promise.resolve();
  });
});
