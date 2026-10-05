/**
 * Finding the extent of the link under the cursor.
 *
 * The range decides what a link edit rewrites, so it has to stop where one link
 * ends and the next begins. Two links can sit immediately adjacent with no text
 * between them, and walking outward by mark TYPE cannot see that boundary: both
 * neighbours carry a link mark, so the range swallows both and editing one
 * silently rewrites the other.
 *
 * @see {@link file://./helpers.ts}
 */
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  createEditorSchema,
  parseMarkdoc,
} from "~/modules/editor-v2/markdoc-utils";

import { findLinkRange } from "./helpers";

const schema = createEditorSchema();

/** A document from markdoc, with the cursor placed at `cursor`. */
function stateFor(markdoc: string, cursor: number) {
  const doc = parseMarkdoc(markdoc, schema);
  const state = EditorState.create({ doc, schema });

  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, cursor))
  );
}

/** The text a link edit would rewrite, for the cursor at `cursor`. */
function rangeTextAt(markdoc: string, cursor: number) {
  const state = stateFor(markdoc, cursor);
  const range = findLinkRange(state, schema.marks.link);

  return range ? state.doc.textBetween(range.from, range.to) : null;
}

describe("findLinkRange", () => {
  it("covers the whole link the cursor sits in", () => {
    expect(rangeTextAt("[alpha](https://one.test)\n", 3)).toBe("alpha");
  });

  it("stops at the boundary between two adjacent links", () => {
    // No text separates them, so only the href tells them apart.
    const markdoc = "[alpha](https://one.test)[beta](https://two.test)\n";

    expect(rangeTextAt(markdoc, 3)).toBe("alpha");
  });

  it("finds the second of two adjacent links, not both", () => {
    const markdoc = "[alpha](https://one.test)[beta](https://two.test)\n";

    // "alpha" is 5 characters from position 1, so "beta" starts at 6.
    expect(rangeTextAt(markdoc, 8)).toBe("beta");
  });

  it("keeps a single link whole when its neighbour is plain text", () => {
    expect(rangeTextAt("see [alpha](https://one.test) now\n", 7)).toBe("alpha");
  });

  it("answers null when the cursor is not in a link", () => {
    expect(rangeTextAt("plain text only\n", 3)).toBeNull();
  });

  it("treats two runs sharing one href as a single link", () => {
    // Same destination, so there is no boundary to respect: an edit should cover
    // the whole thing rather than half of it.
    const markdoc = "[alpha](https://one.test)[beta](https://one.test)\n";

    expect(rangeTextAt(markdoc, 3)).toBe("alphabeta");
  });
});
