import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode, RenderableTreeNodes } from "@markdoc/markdoc";
import { describe, expect, it } from "vitest";
import { chipBareUrls, chipUrlsInNote } from "./link-chips-in-markdoc";

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

  it("leaves a URL inside a fenced code block alone", () => {
    expect(show(render("```\nhttps://x.example/a.pdf\n```"))).toBe(
      "<article><pre>https://x.example/a.pdf\n</pre></article>"
    );
  });

  it("leaves the text of Shelf's own components alone", () => {
    const tree = new Markdoc.Tag("article", {}, [
      new Markdoc.Tag("NameComponent", { text: "https://x.example/a" }, [
        "https://x.example/a",
      ]),
    ]);
    expect(show(chipBareUrls(tree))).toBe(
      "<article><NameComponent>https://x.example/a</NameComponent></article>"
    );
  });

  it("keeps sentence punctuation after a link out of the chip", () => {
    expect(
      show(render("See https://x.example/a.pdf, then https://y.example/b."))
    ).toBe(
      "<article><p>See <LinkChipComponent https://x.example/a.pdf></LinkChipComponent>, then <LinkChipComponent https://y.example/b></LinkChipComponent>.</p></article>"
    );
  });

  it("chips links in list items", () => {
    expect(show(render("- https://x.example/a.pdf"))).toBe(
      "<article><ul><li><LinkChipComponent https://x.example/a.pdf></LinkChipComponent></li></ul></article>"
    );
  });

  it("keeps every part of a string root", () => {
    expect(show(chipBareUrls("see https://x.example/a for details"))).toBe(
      "see <LinkChipComponent https://x.example/a></LinkChipComponent> for details"
    );
  });
});

describe("chipUrlsInNote", () => {
  it("lists the bare links of a comment, not its Markdown links, code or tag attributes", () => {
    expect(
      chipUrlsInNote({
        type: "COMMENT",
        content:
          'See [m](https://a.example/m) `https://b.example/x` {% link to="https://c.example/y" text="z" /%} https://d.example/ok',
      })
    ).toEqual(["https://d.example/ok"]);
  });

  it("lists only the marked values of a system note", () => {
    expect(
      chipUrlsInNote({
        type: "UPDATE",
        content:
          'Sam set {% name text="Manual" /%} to {% name text="see https://a.example/m.pdf" chips=true /%}; renamed to **https://evil.example/login** and {% name text="https://evil.example/b" /%}.',
      })
    ).toEqual(["https://a.example/m.pdf"]);
  });
});
