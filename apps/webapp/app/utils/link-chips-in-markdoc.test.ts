import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode, RenderableTreeNodes } from "@markdoc/markdoc";
import { describe, expect, it } from "vitest";
import { chipBareUrls } from "./link-chips-in-markdoc";

/** Renders a tree to a compact string: text as is, tags as <name attr>…</name>. */
function show(tree: RenderableTreeNodes): string {
  const one = (node: RenderableTreeNode): string => {
    if (typeof node === "string") return node;
    if (!Markdoc.Tag.isTag(node)) return "";
    const url = node.attributes.url ? ` ${node.attributes.url}` : "";
    return `<${node.name}${url}>${node.children.map(one).join("")}</${
      node.name
    }>`;
  };
  return Array.isArray(tree)
    ? tree.map(one).join("")
    : one(tree as RenderableTreeNode);
}

function render(markdown: string) {
  return chipBareUrls(Markdoc.transform(Markdoc.parse(markdown)));
}

describe("chipBareUrls", () => {
  it("turns a bare link in a note into a chip and keeps the text around it", () => {
    expect(show(render("Manual: https://x.example/a.pdf (rev B)"))).toBe(
      "<article><p>Manual: <LinkChipComponent https://x.example/a.pdf></LinkChipComponent> (rev B)</p></article>"
    );
  });

  it("turns a link inside bold text into a chip", () => {
    expect(show(render("set **Manual** to **https://x.example/a.pdf**."))).toBe(
      "<article><p>set <strong>Manual</strong> to <strong><LinkChipComponent https://x.example/a.pdf></LinkChipComponent></strong>.</p></article>"
    );
  });

  it("leaves Markdown links, code and plain text alone", () => {
    expect(
      show(
        render(
          "[Manual](https://x.example/a.pdf) `https://x.example/b` see binder"
        )
      )
    ).toBe(
      "<article><p><a>Manual</a> <code>https://x.example/b</code> see binder</p></article>"
    );
  });

  it("never makes a chip from a script link", () => {
    expect(show(render("javascript:alert(1)"))).toBe(
      "<article><p>javascript:alert(1)</p></article>"
    );
  });
});
