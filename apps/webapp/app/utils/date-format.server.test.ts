import { beforeEach, describe, expect, it, vi } from "vitest";

// why: importing date-format.server transitively loads `~/database/db.server`,
// which instantiates a real Prisma client and connects at module load — under
// `pnpm webapp:test` (no DB) that is an unhandled rejection. Mock the module so
// we control the single user read and never open a connection.
const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));
vi.mock("~/database/db.server", () => ({
  db: { user: { findFirst: findFirstMock } },
}));

import { HARDCODED_DEFAULT_PREFS } from "~/utils/date-format";

import { resolveUserFormatPrefsById } from "./date-format.server";

describe("resolveUserFormatPrefsById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the user's four pref fields and resolves stored values to concrete prefs", async () => {
    findFirstMock.mockResolvedValue({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/London",
    });

    const prefs = await resolveUserFormatPrefsById("user-1", null);

    // Reads only the four pref columns keyed on the user id.
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        dateFormat: true,
        timeFormat: true,
        weekStart: true,
        timeZone: true,
      },
    });
    // MONDAY → weekStartsOn: 1 (react-day-picker convention).
    expect(prefs).toEqual({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStartsOn: 1,
      timeZone: "Europe/London",
    });
  });

  it("falls back to hints for still-null fields (pre-existing, not-yet-backfilled user)", async () => {
    findFirstMock.mockResolvedValue({
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
    });

    const prefs = await resolveUserFormatPrefsById("user-1", {
      locale: "en-GB",
      timeZone: "Europe/London",
    });

    // en-GB → day-first + 24h; timezone from the hint.
    expect(prefs.dateFormat).toBe("DD_MM_YYYY");
    expect(prefs.timeFormat).toBe("H24");
    expect(prefs.timeZone).toBe("Europe/London");
  });

  it("returns the hardcoded default when the user row is missing and no hints", async () => {
    findFirstMock.mockResolvedValue(null);

    const prefs = await resolveUserFormatPrefsById("ghost", null);

    expect(prefs).toEqual(HARDCODED_DEFAULT_PREFS);
  });

  it("uses the provided tx client instead of db when one is passed", async () => {
    const txFindFirst = vi.fn().mockResolvedValue({
      dateFormat: "YYYY_MM_DD",
      timeFormat: "H12",
      weekStart: "SUNDAY",
      timeZone: "UTC",
    });

    const prefs = await resolveUserFormatPrefsById("user-1", null, {
      user: { findFirst: txFindFirst },
    });

    expect(txFindFirst).toHaveBeenCalledOnce();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(prefs.dateFormat).toBe("YYYY_MM_DD");
    expect(prefs.weekStartsOn).toBe(0); // SUNDAY → 0
  });
});
