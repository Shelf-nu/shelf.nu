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
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  DateTimePicker,
  parseWireToParts,
  partsToWire,
} from "./date-time-picker";

// why: useDateFormatter reads useRequestInfo(), which needs the root loader's
// RequestInfo context (unavailable in a unit test). We stub the hook with a
// mutable prefs object (default Monday-start / H24 / DD_MM_YYYY) so individual
// tests can flip `dateFormat` to exercise the token mapping deterministically.
const mockPrefs = vi.hoisted(() => ({
  current: {
    dateFormat: "DD_MM_YYYY" as string,
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "Europe/London",
  },
}));

vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    prefs: mockPrefs.current,
    formatDate: (value: string | Date) =>
      value instanceof Date ? value.toDateString() : value,
    formatTime: (v: string | Date) => String(v),
    formatDateTime: (v: string | Date) => String(v),
  }),
}));

// Reset to the default DD_MM_YYYY pref between tests so a token override in one
// test can't leak into the next.
afterEach(() => {
  mockPrefs.current.dateFormat = "DD_MM_YYYY";
});

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

  it("shows an example date (not the format token) as the empty placeholder", () => {
    // why: an empty typeable input must teach the format by EXAMPLE
    // ("e.g. 24/07/2026"), not leak the raw token ("dd/mm/yyyy" / "mmm d, yyyy")
    // which reads as gibberish to normal users. Mock prefs are DD_MM_YYYY.
    render(<DateTimePicker name="date" mode="date" label="Date" />);
    const text = document.querySelector<HTMLInputElement>('input[type="text"]');
    expect(text?.placeholder).toBe("e.g. 24/07/2026");
  });

  it("renders the month-name example placeholder for a month-name pref", () => {
    mockPrefs.current.dateFormat = "MMM_DD_YYYY";
    render(<DateTimePicker name="date" mode="date" label="Date" />);
    const text = document.querySelector<HTMLInputElement>('input[type="text"]');
    expect(text?.placeholder).toBe("e.g. Jul 24, 2026");
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

  it("surfaces an error and clears the wire when an invalid date is typed then blurred", () => {
    // why: a stale prior value must never be silently submitted. Seed a valid
    // wire, replace it with unparseable text, then blur — the field must show
    // an error and the hidden input (what the form submits) must be empty so
    // downstream required/zod validation fails instead of accepting the old
    // value. Fixed wire strings + DD_MM_YYYY prefs keep this tz-independent.
    render(
      <DateTimePicker name="typed" mode="date" defaultValue="2026-06-22" />
    );
    const text = document.querySelector<HTMLInputElement>('input[type="text"]');
    const hidden = () =>
      document.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="typed"]'
      );

    // The seeded valid wire is present before the invalid edit.
    expect(hidden()?.value).toBe("2026-06-22");

    fireEvent.change(text!, { target: { value: "invalid" } });
    fireEvent.blur(text!);

    // The invalid text stays visible for the user to correct (not reverted).
    expect(text?.value).toBe("invalid");
    // An internal error is surfaced, rendered like the external `error` prop.
    expect(screen.getByText("Please enter a valid date")).toBeTruthy();
    // The stale prior wire is cleared — the form won't submit the old value.
    expect(hidden()?.value).toBe("");
  });

  it("preserves the inline error and invalid text on invalid blur in CONTROLLED mode", () => {
    // why: the booking Start/End date fields are CONTROLLED (value={state} +
    // onChange={setState}). On invalid blur the picker commits "" so
    // required/zod fails instead of submitting the stale prior value; the parent
    // reflects that back as value="". Without the lastEmittedRef echo-guard, the
    // controlled sync effect would then treat that echo as an external change
    // and wipe BOTH the invalid text and the "Please enter a valid date"
    // message — leaving the user at an empty field with no explanation. This
    // asserts they survive the parent round-trip.
    function ControlledWrapper() {
      // Mirrors dates.tsx: parent owns the wire and reflects onChange back.
      const [v, setV] = useState("2026-06-22");
      return (
        <DateTimePicker name="typed" mode="date" value={v} onChange={setV} />
      );
    }
    render(<ControlledWrapper />);
    const text = document.querySelector<HTMLInputElement>('input[type="text"]');
    const hidden = () =>
      document.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="typed"]'
      );

    // The seeded valid wire is present before the invalid edit.
    expect(hidden()?.value).toBe("2026-06-22");

    fireEvent.change(text!, { target: { value: "invalid" } });
    fireEvent.blur(text!);

    // Invalid text survives the value="" echo (was wiped before the fix).
    expect(text?.value).toBe("invalid");
    // Inline error survives the controlled round-trip.
    expect(screen.getByText("Please enter a valid date")).toBeTruthy();
    // Submitted wire is empty so the form rejects the stale prior value.
    expect(hidden()?.value).toBe("");
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

  // Month-name display prefs render AND parse the typeable input in their
  // natural format (e.g. "20 Jul 2026" / "Jul 20, 2026") — option B.
  describe("month-name prefs render + parse the natural format", () => {
    it("renders 'd MMM yyyy' for a DD_MMM_YYYY pref", () => {
      mockPrefs.current.dateFormat = "DD_MMM_YYYY";
      render(<DateTimePicker name="date" value="2026-07-20" label="Date" />);
      const text =
        document.querySelector<HTMLInputElement>('input[type="text"]');
      expect(text?.value).toBe("20 Jul 2026");
    });

    it("renders 'MMM d, yyyy' for a MMM_DD_YYYY pref", () => {
      mockPrefs.current.dateFormat = "MMM_DD_YYYY";
      render(<DateTimePicker name="date" value="2026-07-20" label="Date" />);
      const text =
        document.querySelector<HTMLInputElement>('input[type="text"]');
      expect(text?.value).toBe("Jul 20, 2026");
    });

    it("parses a typed month-name back to the YYYY-MM-DD wire (DD_MMM_YYYY)", () => {
      mockPrefs.current.dateFormat = "DD_MMM_YYYY";
      render(<DateTimePicker name="typed" mode="date" />);
      const text =
        document.querySelector<HTMLInputElement>('input[type="text"]');
      fireEvent.change(text!, { target: { value: "20 Jul 2026" } });
      const hidden = document.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="typed"]'
      );
      expect(hidden?.value).toBe("2026-07-20");
    });
  });
});
