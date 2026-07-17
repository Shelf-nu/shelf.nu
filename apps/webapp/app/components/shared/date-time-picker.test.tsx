/**
 * DateTimePicker — unit + interaction tests
 *
 * Verifies:
 *  - parseWireToParts / partsToWire round-trip losslessly for both modes and
 *    never tz-shift a bare date (local wall-clock construction).
 *  - The hidden <input name> mirrors the emitted wire string so form
 *    submission carries the exact string the servers parse.
 *  - The typeable date input parses the user's format into the wire string.
 *  - Datetime mode renders a separate native time input reflecting the wire.
 *
 * @see {@link file://./date-time-picker.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("rejects malformed date wires instead of silently rolling over", () => {
    // Feb 31 would construct March 3 via JS Date rollover — must be rejected.
    expect(parseWireToParts("2026-02-31").date).toBeUndefined();
    // Month 13 would roll into the next year.
    expect(parseWireToParts("2026-13-01").date).toBeUndefined();
    // Trailing garbage after a valid date must not be accepted.
    expect(parseWireToParts("2026-06-22junk").date).toBeUndefined();
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

  it("normalizes a seconds-carrying seed to the canonical wire (datetime)", () => {
    // A seeded/controlled value can carry seconds (e.g. dateForDateTimeInputValue
    // → "YYYY-MM-DDTHH:mm:ss"). The server parses with DATE_TIME_FORMAT
    // ("yyyy-MM-dd'T'HH:mm") and REJECTS seconds → the submitted wire must strip
    // them, or booking/audit/reminder creation fails with "Invalid Date".
    render(
      <DateTimePicker
        name="dueDate"
        mode="datetime"
        value="2026-06-22T18:30:00"
      />
    );
    const hidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="dueDate"]'
    );
    expect(hidden?.value).toBe("2026-06-22T18:30");
  });

  it("normalizes a date-mode seed that carries a time to just the date", () => {
    render(<DateTimePicker name="d" mode="date" value="2026-06-22T18:30:00" />);
    const hidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="d"]'
    );
    expect(hidden?.value).toBe("2026-06-22");
  });

  it("renders the field label", () => {
    render(
      <DateTimePicker name="date" value="2026-06-22" label="Override Date" />
    );
    expect(screen.getByText("Override Date")).toBeTruthy();
  });

  it("shows the selected date in the typeable input using the workspace format", () => {
    // Mock prefs are DD_MM_YYYY → dd/MM/yyyy tokens.
    render(<DateTimePicker name="date" value="2026-06-22" label="Date" />);
    const text = document.querySelector<HTMLInputElement>('input[type="text"]');
    expect(text?.value).toBe("22/06/2026");
  });

  it("parses a typed date (workspace format) into the wire string", () => {
    // why: uncontrolled so the hidden input reflects the internally-committed
    // wire directly. Mock prefs are DD_MM_YYYY, so type day/month/year.
    render(<DateTimePicker name="typed" mode="date" />);
    const text = document.querySelector<HTMLInputElement>('input[type="text"]');
    fireEvent.change(text!, { target: { value: "22/06/2026" } });
    const hidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="typed"]'
    );
    expect(hidden?.value).toBe("2026-06-22");
  });

  it("leaves the wire unchanged while a partial/invalid date is being typed", () => {
    render(<DateTimePicker name="typed" mode="date" />);
    const text = document.querySelector<HTMLInputElement>('input[type="text"]');
    fireEvent.change(text!, { target: { value: "22/06" } });
    const hidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="typed"]'
    );
    // Raw text is mirrored, but no valid date → wire stays empty.
    expect(text?.value).toBe("22/06");
    expect(hidden?.value).toBe("");
  });

  it("renders a separate native time input reflecting the wire in datetime mode", () => {
    render(
      <DateTimePicker
        name="dueDate"
        mode="datetime"
        value="2026-06-22T18:30"
        label="Due date"
      />
    );
    const timeInput =
      document.querySelector<HTMLInputElement>('input[type="time"]');
    expect(timeInput?.value).toBe("18:30");
  });
});
