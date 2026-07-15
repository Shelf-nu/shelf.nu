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

  it("backfills only the still-null fields, guarded by a null-only where clause", () => {
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

    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        OR: [
          { dateFormat: null },
          { timeFormat: null },
          { weekStart: null },
          { timeZone: null },
        ],
      },
      // Only the null fields are written; dateFormat is left untouched.
      data: {
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Europe/London",
      },
    });
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
