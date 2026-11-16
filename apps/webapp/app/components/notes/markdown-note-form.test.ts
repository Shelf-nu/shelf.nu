/**
 * `MarkdownNoteSchema`: the shared schema every web note and comment route
 * parses user content through before it is stored and rendered by Markdoc.
 *
 * @see {@link file://./markdown-note-form.tsx}
 */
import Markdoc from "@markdoc/markdoc";

import { MarkdownNoteSchema } from "./markdown-note-form";

describe("MarkdownNoteSchema", () => {
  it("strips Markdoc delimiters so the stored note carries no live tag", () => {
    const parsed = MarkdownNoteSchema.parse({
      content: 'Due {% date value="not-a-date" /%} and **bold** text',
    });

    const tags = [...Markdoc.parse(parsed.content).walk()].filter(
      (node) => node.type === "tag"
    );
    expect(tags).toEqual([]);
    expect(parsed.content).toContain("**bold** text");
  });

  it("strips nested delimiters that a single pass would re-form", () => {
    const parsed = MarkdownNoteSchema.parse({
      content: 'Hello {{% date value="x" /%%}} there',
    });

    expect(parsed.content).not.toMatch(/\{%|%\}/);
  });

  it("rejects content that is only delimiters", () => {
    expect(MarkdownNoteSchema.safeParse({ content: "{% %}" }).success).toBe(
      false
    );
  });

  it("keeps ordinary markdown unchanged", () => {
    const content = "Checked the [manual](https://example.com) - all good";

    expect(MarkdownNoteSchema.parse({ content }).content).toBe(content);
  });
});
