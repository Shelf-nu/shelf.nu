import { describe, expect, it } from "vitest";
import { formatDateForICal } from "./date-fns";
import {
  buildBookingICalendar,
  buildBookingVEvent,
  escapeICalText,
  foldLine,
} from "./ics";

describe("escapeICalText", () => {
  it("escapes backslashes", () => {
    expect(escapeICalText("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("escapes semicolons", () => {
    expect(escapeICalText("a;b;c")).toBe("a\\;b\\;c");
  });

  it("escapes commas", () => {
    expect(escapeICalText("one,two,three")).toBe("one\\,two\\,three");
  });

  it("escapes newlines", () => {
    expect(escapeICalText("line1\nline2")).toBe("line1\\nline2");
  });

  it("handles all special characters together", () => {
    expect(escapeICalText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("returns plain text unchanged", () => {
    expect(escapeICalText("Hello World")).toBe("Hello World");
  });

  it("handles empty string", () => {
    expect(escapeICalText("")).toBe("");
  });
});

describe("foldLine", () => {
  it("returns short lines unchanged", () => {
    const line = "SUMMARY:Short booking";
    expect(foldLine(line)).toBe(line);
  });

  it("returns exactly 75-octet lines unchanged", () => {
    const line = "A".repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it("folds lines longer than 75 octets", () => {
    const line = "DESCRIPTION:" + "x".repeat(100);
    const result = foldLine(line);
    const parts = result.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    // First line: exactly 75 octets
    expect(new TextEncoder().encode(parts[0]).length).toBe(75);
    // Continuation lines start with a space
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i][0]).toBe(" ");
    }
  });

  it("never exceeds 75 octets per line (ASCII)", () => {
    const line = "DESCRIPTION:" + "abcdefghij".repeat(20);
    const result = foldLine(line);
    const parts = result.split("\r\n");
    for (const part of parts) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it("never exceeds 75 octets per line (multi-byte characters)", () => {
    // Thai characters are 3 bytes each in UTF-8
    const line = "SUMMARY:" + "กรุงเทพมหานคร".repeat(5);
    const result = foldLine(line);
    const parts = result.split("\r\n");
    for (const part of parts) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it("does not split multi-byte characters", () => {
    // Each emoji is 4 bytes in UTF-8. Fill a line so folding must happen
    // mid-emoji-territory — the fold should back up to a character boundary.
    const line = "SUMMARY:" + "😀".repeat(30);
    const result = foldLine(line);
    const parts = result.split("\r\n");
    for (const part of parts) {
      // If a multi-byte char were split, decoding would produce U+FFFD
      expect(part).not.toContain("\uFFFD");
    }
  });

  it("preserves full content after round-trip unfold", () => {
    const line =
      "DESCRIPTION:" + "Hello, world! Special chars: é ñ ü ☀ 🎉".repeat(5);
    const folded = foldLine(line);
    // RFC 5545 unfolding: remove CRLF + single SPACE
    const unfolded = folded.replace(/\r\n /g, "");
    expect(unfolded).toBe(line);
  });
});

describe("formatDateForICal", () => {
  it("formats a date in UTC with Z suffix", () => {
    // 2026-03-15 14:30:00 UTC
    const date = new Date(Date.UTC(2026, 2, 15, 14, 30, 0));
    expect(formatDateForICal(date)).toBe("20260315T143000Z");
  });

  it("zero-pads single-digit months, days, hours, minutes, seconds", () => {
    // 2026-01-05 09:05:03 UTC
    const date = new Date(Date.UTC(2026, 0, 5, 9, 5, 3));
    expect(formatDateForICal(date)).toBe("20260105T090503Z");
  });

  it("handles midnight correctly", () => {
    const date = new Date(Date.UTC(2026, 11, 31, 0, 0, 0));
    expect(formatDateForICal(date)).toBe("20261231T000000Z");
  });

  it("handles end-of-day correctly", () => {
    const date = new Date(Date.UTC(2026, 5, 15, 23, 59, 59));
    expect(formatDateForICal(date)).toBe("20260615T235959Z");
  });

  it("uses UTC regardless of the date's timezone offset", () => {
    // Creating a date from a local string — formatDateForICal should
    // always output the UTC equivalent, not the local time.
    const date = new Date("2026-07-04T12:00:00-05:00"); // CDT
    expect(formatDateForICal(date)).toBe("20260704T170000Z");
  });
});

describe("buildBookingVEvent", () => {
  const baseInput = {
    id: "booking-123",
    name: "Studio shoot",
    from: new Date(Date.UTC(2026, 5, 10, 9, 0, 0)),
    to: new Date(Date.UTC(2026, 5, 10, 17, 0, 0)),
    custodianName: "Erfan R",
    assetTitles: ["Camera A", "Tripod"],
    bookingUrl: "https://app.shelf.nu/bookings/booking-123",
    updatedAt: new Date(Date.UTC(2026, 5, 1, 8, 0, 0)),
  };

  it("emits a well-formed VEVENT with summary, dates, description and alarm", () => {
    const lines = buildBookingVEvent(baseInput);
    expect(lines[0]).toBe("BEGIN:VEVENT");
    expect(lines.at(-1)).toBe("END:VEVENT");
    expect(lines).toContain("UID:booking-123");
    expect(lines).toContain(`DTSTART:${formatDateForICal(baseInput.from)}`);
    expect(lines).toContain(`DTEND:${formatDateForICal(baseInput.to)}`);
    // DTSTAMP is booking-derived (stable per poll), not fetch time.
    expect(lines).toContain(
      `DTSTAMP:${formatDateForICal(baseInput.updatedAt)}`
    );
    // Summary includes the asset count
    expect(lines).toContain("SUMMARY:Studio shoot (2 assets)");
    // 1-day-before reminder alarm
    expect(lines).toContain("BEGIN:VALARM");
    expect(lines).toContain("TRIGGER;RELATED=END:-P1D");
    // Description carries custodian, assets (comma escaped) and the link
    const description = lines.find((l) => l.startsWith("DESCRIPTION:"));
    expect(description).toContain("Custodian: Erfan R");
    expect(description).toContain("Assets (2): Camera A\\, Tripod");
    expect(description).toContain(
      "View booking: https://app.shelf.nu/bookings/booking-123"
    );
  });

  it("uses the singular label and 'No assets assigned' when there are no assets", () => {
    const one = buildBookingVEvent({ ...baseInput, assetTitles: ["Only one"] });
    expect(one).toContain("SUMMARY:Studio shoot (1 asset)");

    const none = buildBookingVEvent({ ...baseInput, assetTitles: [] });
    expect(none).toContain("SUMMARY:Studio shoot"); // no count suffix
    const description = none.find((l) => l.startsWith("DESCRIPTION:"));
    expect(description).toContain("Assets (0): No assets assigned");
  });

  it("omits the custodian line when custodianName is empty (custody hidden)", () => {
    const lines = buildBookingVEvent({ ...baseInput, custodianName: "" });
    const description = lines.find((l) => l.startsWith("DESCRIPTION:"));
    expect(description).not.toContain("Custodian:");
    expect(description).toContain("Assets (2):");
  });

  it("escapes special characters in the summary", () => {
    const lines = buildBookingVEvent({
      ...baseInput,
      name: "Shoot; Berlin, Studio B",
      assetTitles: [],
    });
    expect(lines).toContain("SUMMARY:Shoot\\; Berlin\\, Studio B");
  });
});

describe("buildBookingICalendar", () => {
  const vevent = buildBookingVEvent({
    id: "b1",
    name: "Booking one",
    from: new Date(Date.UTC(2026, 0, 1, 10, 0, 0)),
    to: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
    custodianName: "Sam",
    assetTitles: ["Lens"],
    bookingUrl: "https://app.shelf.nu/bookings/b1",
    updatedAt: new Date(Date.UTC(2026, 0, 1, 9, 0, 0)),
  });

  it("wraps events in a VCALENDAR envelope with CRLF line endings", () => {
    const ics = buildBookingICalendar([vevent]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Shelf.nu//Shelf Calendar 1.0//EN");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics.split("\r\n")).toContain("BEGIN:VEVENT");
  });

  it("omits X-WR-CALNAME by default and includes it (escaped) when named", () => {
    expect(buildBookingICalendar([vevent])).not.toContain("X-WR-CALNAME");
    const named = buildBookingICalendar([vevent], {
      calendarName: "Acme, Inc bookings",
    });
    expect(named).toContain("X-WR-CALNAME:Acme\\, Inc bookings");
  });

  it("includes every event in a multi-event feed", () => {
    const second = buildBookingVEvent({
      id: "b2",
      name: "Booking two",
      from: new Date(Date.UTC(2026, 0, 2, 10, 0, 0)),
      to: new Date(Date.UTC(2026, 0, 2, 12, 0, 0)),
      custodianName: "Pat",
      assetTitles: [],
      bookingUrl: "https://app.shelf.nu/bookings/b2",
      updatedAt: new Date(Date.UTC(2026, 0, 2, 9, 0, 0)),
    });
    const ics = buildBookingICalendar([vevent, second]);
    expect(ics).toContain("UID:b1");
    expect(ics).toContain("UID:b2");
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });

  it("folds long lines so every line stays within 75 octets", () => {
    const longVevent = buildBookingVEvent({
      id: "b3",
      name: "X".repeat(200),
      from: new Date(Date.UTC(2026, 0, 3, 10, 0, 0)),
      to: new Date(Date.UTC(2026, 0, 3, 12, 0, 0)),
      custodianName: "Q",
      assetTitles: [],
      bookingUrl: "https://app.shelf.nu/bookings/b3",
      updatedAt: new Date(Date.UTC(2026, 0, 3, 9, 0, 0)),
    });
    const ics = buildBookingICalendar([longVevent]);
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
