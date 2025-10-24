import { describe, expect, it } from "vitest";

import {
  countRawBlocks,
  createEditorSchema,
  parseMarkdoc,
  serializeMarkdoc,
} from "~/modules/editor-v2/markdoc-utils";

const schema = createEditorSchema();

describe("EditorV2 Markdoc round trip", () => {
  it("round-trips supported nodes and marks", () => {
    const source = [
      "# Title",
      "",
      "Paragraph with **bold**, *italic*, `code`, and [link](https://example.com).",
      "",
      "## Heading 2",
      "",
      "- Item one",
      "- Item two",
      "",
      "1. First",
      "2. Second",
      "",
      "> Quote line",
      ">",
      "> Another line",
      "",
      "---",
      "",
    ].join("\n");

    const parsed = parseMarkdoc(source, schema);

    expect(parsed.type.name).toBe("doc");
    expect(parsed.childCount).toBeGreaterThan(0);
    expect(countRawBlocks(parsed)).toBe(0);

    const serialized = serializeMarkdoc(parsed, schema);
    expect(serialized).toEqual(source);
  });

  it("preserves unsupported markdoc tags as raw blocks", () => {
    const source = [
      "Paragraph before",
      "",
      '{% callout title="Heads up" %}',
      "Content inside",
      "{% /callout %}",
      "",
      "Paragraph after",
      "",
    ].join("\n");

    const parsed = parseMarkdoc(source, schema);

    expect(countRawBlocks(parsed)).toBe(1);

    const serialized = serializeMarkdoc(parsed, schema);
    expect(serialized).toEqual(source);
  });
});
