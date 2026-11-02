/**
 * Bare URLs in MULTILINE_TEXT custom field values become links; Markdown
 * anywhere else (notes, descriptions) keeps Markdoc's default, where they stay
 * text.
 *
 * @see {@link file://./markdoc-linkify.ts}
 * @see {@link file://./custom-fields.ts} `getCustomFieldDisplayValue`
 */
import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import { describe, expect, it } from "vitest";

import { getCustomFieldDisplayValue } from "./custom-fields";
import { parseMarkdownToReact } from "./md";

function renderMultiline(raw: string): string {
  return Markdoc.renderers.html(
    getCustomFieldDisplayValue({
      raw,
      valueMultiLineText: raw,
    }) as RenderableTreeNode
  );
}

describe("MULTILINE_TEXT custom field links", () => {
  it("links a bare URL and leaves the sentence around it", () => {
    expect(renderMultiline("Manual: https://example.com/a.pdf.")).toBe(
      '<article><p>Manual: <a href="https://example.com/a.pdf?ref=shelf-webapp">https://example.com/a.pdf</a>.</p></article>'
    );
  });

  it("links URLs inside emphasis", () => {
    expect(renderMultiline("**See https://example.com/a**")).toBe(
      '<article><p><strong>See <a href="https://example.com/a?ref=shelf-webapp">https://example.com/a</a></strong></p></article>'
    );
  });

  it("keeps an authored Markdown link as written", () => {
    expect(renderMultiline("[the manual](https://example.com/a)")).toBe(
      '<article><p><a href="https://example.com/a">the manual</a></p></article>'
    );
  });

  it("leaves URLs in code alone", () => {
    expect(renderMultiline("`https://example.com/a`")).toBe(
      "<article><p><code>https://example.com/a</code></p></article>"
    );
  });

  it("does not link bare URLs in other Markdown, such as notes", () => {
    expect(
      Markdoc.renderers.html(
        parseMarkdownToReact("Manual: https://example.com/a.pdf")
      )
    ).toBe("<article><p>Manual: https://example.com/a.pdf</p></article>");
  });
});
