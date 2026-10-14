import Markdoc from "@markdoc/markdoc";
import { describe, expect, it } from "vitest";

import { buildDescriptionChangeNote } from "~/modules/note/helpers.server";
import { encodeRawTagAttributeValues } from "./markdoc-tag-strings";
import {
  wrapAssetsWithDataForNote,
  wrapCategoryForNote,
  wrapDescriptionForNote,
  wrapKitsWithDataForNote,
  wrapLinkForNote,
  wrapTagForNote,
  wrapUserLinkForNote,
} from "./markdoc-wrappers";

const userLink = wrapUserLinkForNote({
  id: "user-1",
  firstName: "Jane",
  lastName: "Doe",
  displayName: null,
});

/** Tag nodes Markdoc finds in `content`, as `{ tag, attributes }`. */
function parsedTags(content: string) {
  return [...Markdoc.parse(content).walk()]
    .filter((node) => node.type === "tag")
    .map((node) => ({ tag: node.tag, attributes: node.attributes }));
}

/** Tag nodes in `content` once encoded the way `SystemNoteViewer` encodes it. */
function renderedTags(content: string) {
  return parsedTags(encodeRawTagAttributeValues(content));
}

describe("encodeRawTagAttributeValues", () => {
  describe("description change notes", () => {
    it("parses a change to a multi-line description", () => {
      const note = buildDescriptionChangeNote({
        userLink,
        previous: "aa",
        next: "b\nc",
      });

      expect(parsedTags(note!)).not.toContainEqual(
        expect.objectContaining({ tag: "description" })
      );
      expect(renderedTags(note!)).toContainEqual({
        tag: "description",
        attributes: { oldText: "aa", newText: "b\nc" },
      });
    });

    it("parses Windows line breaks as single line breaks", () => {
      const note = buildDescriptionChangeNote({
        userLink,
        previous: "first line\r\nsecond line",
        next: "only line",
      });

      expect(renderedTags(note!)).toContainEqual({
        tag: "description",
        attributes: {
          oldText: "first line\nsecond line",
          newText: "only line",
        },
      });
    });

    it("parses blank lines, tabs and a lone carriage return", () => {
      const note = buildDescriptionChangeNote({
        userLink,
        previous: "para one\r\n\r\npara two",
        next: "col\tvalue\rnext",
      });

      expect(renderedTags(note!)).toContainEqual({
        tag: "description",
        attributes: {
          oldText: "para one\n\npara two",
          newText: "col\tvalue\nnext",
        },
      });
    });

    it("parses added and removed multi-line descriptions", () => {
      const added = buildDescriptionChangeNote({
        userLink,
        previous: null,
        next: "line 1\nline 2",
      });
      const removed = buildDescriptionChangeNote({
        userLink,
        previous: "line 1\r\nline 2",
        next: "",
      });

      expect(renderedTags(added!)).toContainEqual({
        tag: "description",
        attributes: { newText: "line 1\nline 2" },
      });
      expect(renderedTags(removed!)).toContainEqual({
        tag: "description",
        attributes: { oldText: "line 1\nline 2" },
      });
    });

    it("keeps backslashes and quotes as typed", () => {
      const tag = wrapDescriptionForNote(
        'Path C:\\new\\temp\\ and a "quote"',
        "ends with a backslash\\"
      );

      expect(renderedTags(tag)).toEqual([
        {
          tag: "description",
          attributes: {
            oldText: "Path C:\\new\\temp\\ and a &quot;quote&quot;",
            newText: "ends with a backslash\\",
          },
        },
      ]);
    });

    it("leaves the rest of the note intact", () => {
      const note = buildDescriptionChangeNote({
        userLink,
        previous: "aa",
        next: "b\nc",
      });

      expect(renderedTags(note!)).toEqual([
        {
          tag: "link",
          attributes: { to: "/settings/team/users/user-1", text: "Jane Doe" },
        },
        {
          tag: "description",
          attributes: { oldText: "aa", newText: "b\nc" },
        },
      ]);
    });
  });

  describe("other wrappers", () => {
    it("parses an asset link whose title has a line break", () => {
      const content = `moved ${wrapAssetsWithDataForNote({
        id: "asset-1",
        title: "Camera\r\nbody",
      })} to a new location.`;

      expect(renderedTags(content)).toEqual([
        {
          tag: "link",
          attributes: { to: "/assets/asset-1", text: "Camera\nbody" },
        },
      ]);
    });

    it("parses a user link whose name has a backslash", () => {
      const content = `${wrapUserLinkForNote({
        id: "user-2",
        firstName: "Customer\\Barbara",
        lastName: "Smith",
        displayName: null,
      })} checked out the asset.`;

      expect(parsedTags(content)).not.toContainEqual(
        expect.objectContaining({ tag: "link" })
      );
      expect(renderedTags(content)).toEqual([
        {
          tag: "link",
          attributes: {
            to: "/settings/team/users/user-2",
            text: "Customer\\Barbara Smith",
          },
        },
      ]);
    });

    it("parses kit, tag, category and generic links with line breaks", () => {
      const content = [
        wrapKitsWithDataForNote({ id: "kit-1", name: "Kit\none" }),
        wrapTagForNote({ id: "tag-1", name: "Tag\r\none" }),
        wrapCategoryForNote({ id: "cat-1", name: "Cat\\one", color: "#fff" }),
        wrapLinkForNote("/locations/loc-1", "Shelf\tA"),
      ].join(" ");

      expect(renderedTags(content)).toEqual([
        { tag: "link", attributes: { to: "/kits/kit-1", text: "Kit\none" } },
        { tag: "tag", attributes: { name: "Tag\none", id: "tag-1" } },
        {
          tag: "category_badge",
          attributes: { name: "Cat\\one", color: "#fff" },
        },
        {
          tag: "link",
          attributes: { to: "/locations/loc-1", text: "Shelf\tA" },
        },
      ]);
    });
  });

  describe("content it does not change", () => {
    it("returns content without tags as-is", () => {
      const content = "line one\nline two with a \\ backslash";

      expect(encodeRawTagAttributeValues(content)).toBe(content);
    });

    it("returns valid single-line notes as-is", () => {
      const note = buildDescriptionChangeNote({
        userLink,
        previous: "aa",
        next: "bb",
      })!;

      expect(encodeRawTagAttributeValues(note)).toBe(note);
    });

    it("keeps line breaks between tags and outside quoted values", () => {
      const content = `${userLink}\nadded {% assets_list count=2\nids="a,b" action="added" /%}.`;

      expect(encodeRawTagAttributeValues(content)).toBe(content);
    });

    it("leaves a tag that is never closed untouched", () => {
      const content = `${userLink} wrote {% link text="a\nb"`;

      expect(encodeRawTagAttributeValues(content)).toBe(
        `${userLink} wrote {% link text="a\nb"`
      );
    });

    it("returns notes whose tags hold nothing to encode as the same string", () => {
      const content = `${userLink} moved\nC:\\temp {% audit_images count=3 ids="a,b" /%}`;

      expect(encodeRawTagAttributeValues(content)).toBe(content);
    });

    it("keeps closing tags and bare values valid", () => {
      const content = `{% /tag %}\n{% audit_images count=3 ids="a,b" /%}`;

      expect(encodeRawTagAttributeValues(content)).toBe(content);
      expect(renderedTags(content)).toContainEqual({
        tag: "audit_images",
        attributes: { count: 3, ids: "a,b" },
      });
    });

    it("leaves a value holding a Markdoc-style escaped quote as stored", () => {
      const content = `{% link to="/u" text="say \\"hi\\"\nthere" /%}`;

      expect(encodeRawTagAttributeValues(content)).toBe(content);
    });
  });

  describe("text that is not a writer tag", () => {
    it("copies a stray {% in plain text and encodes the tag after it", () => {
      const description = wrapDescriptionForNote("aa", "b\nc");

      expect(
        encodeRawTagAttributeValues(`typed {% "A then ${description}`)
      ).toBe(
        'typed {% "A then {% description oldText="aa" newText="b\\nc" /%}'
      );
    });

    it("encodes a valid tag that follows an unclosed {%", () => {
      const content = `Typed {% oops\n\nthen ${wrapDescriptionForNote(
        "aa",
        "b\nc"
      )}`;

      expect(encodeRawTagAttributeValues(content)).toBe(
        'Typed {% oops\n\nthen {% description oldText="aa" newText="b\\nc" /%}'
      );
      expect(renderedTags(content)).toContainEqual({
        tag: "description",
        attributes: { oldText: "aa", newText: "b\nc" },
      });
    });
  });

  describe("hostile input", () => {
    /** Repeats `unit` to about 1 MB and ends it with a line break. */
    function hostile(unit: string) {
      return unit.repeat(Math.ceil(1_000_000 / unit.length)) + "\n";
    }

    it.each([
      ["quoted values that never close", '{% a="'],
      ["openers that never close", "{%"],
      ["attributes that never close", '{% a="x" '],
      ["tag attributes that never close", '{% t a="x" '],
      ["quotes that nest tag openers", '{% t a="{% t a="x" b="'],
    ])("scans %s in linear time", (_label, unit) => {
      const content = hostile(unit);

      const started = performance.now();
      const result = encodeRawTagAttributeValues(content);
      const elapsed = performance.now() - started;

      expect(result).toBe(content);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  it("does not let a description open a tag of its own", () => {
    // The value closes the tag and opens a link, and is kept inside the quoted
    // attribute: one description tag, no link.
    const tag = wrapDescriptionForNote(
      undefined,
      'x %}\n{% link to="javascript:alert(1)" text="hi" /%}\n{%'
    );

    expect(renderedTags(tag)).toEqual([
      {
        tag: "description",
        attributes: {
          newText:
            "x %}\n{% link to=&quot;javascript:alert(1)&quot; text=&quot;hi&quot; /%}\n{%",
        },
      },
    ]);
  });
});
