/**
 * Unit tests for the pure audit note-content helpers.
 * These guard the Markdoc-injection fix: user content must never be able
 * to introduce its own `{% ... %}` tags into an image-evidence note.
 */
import {
  stripMarkdocDelimiters,
  buildAuditImagesNoteContent,
} from "~/modules/audit/note-content.server";

describe("stripMarkdocDelimiters", () => {
  it("removes opening and closing Markdoc delimiters", () => {
    expect(
      stripMarkdocDelimiters('evil {% audit_images ids="stolen" /%} text')
    ).toBe('evil  audit_images ids="stolen" / text');
  });

  it("leaves clean content untouched", () => {
    expect(stripMarkdocDelimiters("Dent on the top-left corner")).toBe(
      "Dent on the top-left corner"
    );
  });

  it("trims surrounding whitespace", () => {
    expect(stripMarkdocDelimiters("  hello  ")).toBe("hello");
  });
});

describe("buildAuditImagesNoteContent", () => {
  it("appends a single trusted audit_images tag with the sanitized body", () => {
    const result = buildAuditImagesNoteContent({
      content: 'crack {% audit_images ids="x" /%}',
      imageIds: ["img-1"],
    });
    expect(result).toBe(
      'crack  audit_images ids="x" /\n\n{% audit_images count=1 ids="img-1" /%}'
    );
  });

  it("joins multiple image ids and counts them", () => {
    const result = buildAuditImagesNoteContent({
      content: "set of photos",
      imageIds: ["a", "b", "c"],
    });
    expect(result).toBe(
      'set of photos\n\n{% audit_images count=3 ids="a,b,c" /%}'
    );
  });
});
