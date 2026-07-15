import { describe, expect, it } from "vitest";

import { formatDate, HARDCODED_DEFAULT_PREFS } from "./date-format";
import { sanitizeNoteContent } from "./note-sanitizer.server";

// why: HARDCODED_DEFAULT_PREFS is the concrete fallback prefs the formatter
// consumes; using it keeps these assertions independent of any user row.
const prefs = HARDCODED_DEFAULT_PREFS;

describe("sanitizeNoteContent", () => {
  const sanitize = (content: string) => sanitizeNoteContent(content, prefs);

  it("strips markdoc link tags and decodes entities", () => {
    const content =
      '{% link to="/bookings/abc" text="Booking &quot;A&quot;" /%} updated.';

    expect(sanitize(content)).toBe('Booking "A" updated.');
  });

  it("formats markdoc date tags via formatDate, respecting includeTime", () => {
    const iso = "2023-12-25T10:30:00.000Z";
    const content = `Due {% date value="${iso}" includeTime=false /%} and scheduled {% date value="${iso}" /%}.`;

    const expectedDate = formatDate(iso, prefs);
    const expectedDateTime = formatDate(iso, prefs, { includeTime: true });

    expect(sanitize(content)).toBe(
      `Due ${expectedDate} and scheduled ${expectedDateTime}.`
    );
  });

  it("returns the raw value for an unparseable date", () => {
    expect(sanitizeNoteContent('{% date value="not-a-date" /%}', prefs)).toBe(
      "not-a-date"
    );
  });

  it("converts assets and kits markdoc tags to readable counts", () => {
    const content =
      'Removed {% assets_list count=3 ids="1,2,3" action="removed" /%} and assigned {% kits_list count=1 ids="kit" action="added" /%}.';

    expect(sanitize(content)).toBe("Removed 3 assets and assigned 1 kit.");
  });

  it("normalizes description markdoc tags", () => {
    const content =
      'Description changed {% description oldText="Old text" newText="New text" /%}.';

    expect(sanitize(content)).toBe("Description changed Old text -> New text.");
  });

  it("cleans markdown formatting while preserving line breaks", () => {
    const content = `# Heading

- one
- two

**Bold** text with [link](https://example.com) and code \`const x = 1\`.
`;

    expect(sanitize(content)).toBe(`Heading

- one
- two

Bold text with link and code const x = 1.`);
  });
});
