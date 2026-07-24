import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Column } from "~/modules/asset-index-settings/helpers";

import { getDefaultValueForFieldType, getUIFieldType } from "./helpers";

describe("getUIFieldType", () => {
  it("treats updatedAt as a date field", () => {
    const updatedColumn = {
      name: "updatedAt",
      visible: true,
      position: 0,
    } as unknown as Column;

    expect(getUIFieldType({ column: updatedColumn })).toBe("date");
    expect(getUIFieldType({ column: updatedColumn, friendlyName: true })).toBe(
      "Date"
    );
  });
});

/**
 * Computes today's calendar day (YYYY-MM-DD) in a given IANA timezone using an
 * independent implementation (Intl), so the assertion doesn't just re-run the
 * production helper against itself.
 */
function expectedTodayInTz(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, matching the wire format the helper emits.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

describe("getDefaultValueForFieldType — date defaults use the user's timezone", () => {
  // why: getTodayInUserTimezone (production) and expectedTodayInTz (assertion)
  // each read the system clock independently. Without a frozen instant the two
  // reads can straddle midnight in the tested timezone and flake. Pinning a
  // fixed UTC instant makes both sides derive the same calendar day regardless
  // of the machine's local timezone, keeping the test deterministic.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds a built-in date column with today's calendar day in a non-UTC timezone", () => {
    const createdAtColumn = {
      name: "createdAt",
      visible: true,
      position: 0,
    } as unknown as Column;

    const timeZone = "Asia/Tokyo";

    expect(getDefaultValueForFieldType(createdAtColumn, null, timeZone)).toBe(
      expectedTodayInTz(timeZone)
    );
  });

  it("seeds a custom-field DATE column with today's calendar day in a non-UTC timezone", () => {
    const cfDateColumn = {
      name: "cf_Warranty",
      cfType: "DATE",
      visible: true,
      position: 0,
    } as unknown as Column;

    const timeZone = "America/New_York";

    expect(getDefaultValueForFieldType(cfDateColumn, [], timeZone)).toBe(
      expectedTodayInTz(timeZone)
    );
  });

  it("returns a YYYY-MM-DD string for date defaults", () => {
    const createdAtColumn = {
      name: "createdAt",
      visible: true,
      position: 0,
    } as unknown as Column;

    expect(
      getDefaultValueForFieldType(createdAtColumn, null, "Europe/Berlin")
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not seed non-date columns with a date", () => {
    const nameColumn = {
      name: "name",
      visible: true,
      position: 0,
    } as unknown as Column;

    expect(getDefaultValueForFieldType(nameColumn, null, "Asia/Tokyo")).toBe(
      ""
    );
  });
});
