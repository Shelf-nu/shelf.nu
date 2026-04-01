import { describe, expect, it } from "vitest";
import { formatDateForICal } from "./date-fns";
import { escapeICalText, foldLine } from "./ics";

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
