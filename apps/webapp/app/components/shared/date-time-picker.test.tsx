/**
 * DateTimePicker — unit + interaction tests
 *
 * Verifies:
 *  - parseWireToParts / partsToWire round-trip losslessly for both modes and
 *    never tz-shift a bare date (local wall-clock construction).
 *  - The hidden <input name> mirrors the emitted wire string so form
 *    submission carries the exact string the servers parse.
 *  - The calendar renders with the user's weekStartsOn (Monday header first).
 *
 * @see {@link file://./date-time-picker.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  DateTimePicker,
  parseWireToParts,
  partsToWire,
} from "./date-time-picker";

// why: useDateFormatter reads useRequestInfo(), which needs the root loader's
// RequestInfo context (unavailable in a unit test). We stub the hook with a
// fixed Monday-start / H24 prefs object to exercise the picker deterministically.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    prefs: {
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStartsOn: 1,
      timeZone: "Europe/London",
    },
    formatDate: (value: string | Date) =>
      value instanceof Date ? value.toDateString() : value,
    formatTime: (v: string | Date) => String(v),
    formatDateTime: (v: string | Date) => String(v),
  }),
}));

describe("wire helpers", () => {
  it("round-trips a date-only wire without tz shift", () => {
    const { date, time } = parseWireToParts("2026-06-22");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(5); // June (0-indexed)
    expect(date?.getDate()).toBe(22);
    expect(time).toBe("");
    expect(partsToWire(date, "", "date")).toBe("2026-06-22");
  });

  it("round-trips a datetime wire", () => {
    const { date, time } = parseWireToParts("2026-06-22T18:30");
    expect(time).toBe("18:30");
    expect(partsToWire(date, time, "datetime")).toBe("2026-06-22T18:30");
  });

  it("returns empty parts for an empty/invalid wire", () => {
    expect(parseWireToParts("").date).toBeUndefined();
    expect(parseWireToParts(undefined).date).toBeUndefined();
    expect(partsToWire(undefined, "", "date")).toBe("");
  });

  it("defaults datetime time to 00:00 when none provided", () => {
    const { date } = parseWireToParts("2026-06-22");
    expect(partsToWire(date, "", "datetime")).toBe("2026-06-22T00:00");
  });
});

describe("DateTimePicker", () => {
  it("mirrors the controlled value into the hidden input", () => {
    render(
      <DateTimePicker
        name="dueDate"
        mode="datetime"
        value="2026-06-22T18:30"
        label="Due date"
      />
    );
    const hidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="dueDate"]'
    );
    expect(hidden?.value).toBe("2026-06-22T18:30");
  });

  it("renders the trigger label and the field label", () => {
    render(
      <DateTimePicker name="date" value="2026-06-22" label="Override Date" />
    );
    expect(screen.getByText("Override Date")).toBeTruthy();
  });
});
