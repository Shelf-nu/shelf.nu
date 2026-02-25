import { describe, expect, it } from "vitest";

import { sanitizeNoteContent } from "./note-sanitizer.server";

const formatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "UTC",
});

describe("sanitizeNoteContent", () => {
  const sanitize = (content: string) => sanitizeNoteContent(content, formatter);

  it("strips markdoc link tags and decodes entities", () => {
    const content =
      '{% link to="/bookings/abc" text="Booking &quot;A&quot;" /%} updated.';

    expect(sanitize(content)).toBe('Booking "A" updated.');
  });

  it("formats markdoc date tags respecting includeTime", () => {
    const content =
      'Due {% date value="2023-12-25T10:30:00.000Z" includeTime=false /%} and scheduled {% date value="2023-12-25T10:30:00.000Z" /%}.';

    expect(sanitize(content)).toBe(
      "Due 12/25/23 and scheduled 12/25/23, 10:30 AM."
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

  it("handles real-world activity note content", () => {
    const content =
      '{% link to="/settings/team/users/94a8f5d8" text="Nikolayz Bonevz" /%} created a new reminder {% link to="/assets/asset-1/reminders?s=kekeroo" text="kekeroo" /%}.';

    expect(sanitize(content)).toBe(
      "Nikolayz Bonevz created a new reminder kekeroo."
    );
  });

  it("falls back when formatter lacks resolvedOptions", () => {
    const fallbackFormatter = {
      format: (date: Date) => `formatted-${date.toISOString()}`,
    } as unknown as Intl.DateTimeFormat;

    const dateOnly = new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
    }).format(new Date("2024-01-15T12:00:00.000Z"));

    expect(
      sanitizeNoteContent(
        '{% date value="2024-01-15T12:00:00.000Z" includeTime=false /%}',
        fallbackFormatter
      )
    ).toBe(dateOnly);
  });
});
