/**
 * Tests for the note sanitizer (`~/utils/note-sanitizer.server`).
 *
 * The sanitizer turns a stored note into the plain text that CSV exports and
 * generated PDFs carry, so these cases cover what a customer ends up reading:
 * each Markdoc tag the note builders emit is reduced to its human-readable
 * part, dates are formatted in the caller's preferences, and markdown
 * decoration is stripped while line breaks survive. A tag the sanitizer fails
 * to match leaks raw `{% … /%}` syntax into a downloaded file, which is the
 * failure these assertions exist to catch.
 *
 * @see {@link file://./note-sanitizer.server.ts}
 */
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

  it("reads through attribute values containing a percent sign", () => {
    // `%` is ordinary text in a title or a description, and it must not leave
    // raw tag syntax in the CSV/PDF a customer downloads.
    const content =
      '{% link to="/assets/1" text="Summer Sale 50% Off" /%} description set to {% description newText="Battery at 30% capacity" /%}.';

    expect(sanitize(content)).toBe(
      "Summer Sale 50% Off description set to Battery at 30% capacity."
    );
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
