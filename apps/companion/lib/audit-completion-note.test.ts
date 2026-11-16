/**
 * Tests for the audit closing note.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./audit-completion-note.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completionNoteFromInput } from "./audit-completion-note";

describe("completionNoteFromInput", () => {
  it("sends no note for an empty field", () => {
    assert.equal(completionNoteFromInput(""), undefined);
  });

  it("sends no note for a field holding only whitespace", () => {
    assert.equal(completionNoteFromInput("   \n\t "), undefined);
  });

  it("sends the note without its surrounding whitespace", () => {
    assert.equal(
      completionNoteFromInput("  Two laptops were out on loan. \n"),
      "Two laptops were out on loan."
    );
  });

  it("keeps line breaks inside the note", () => {
    assert.equal(
      completionNoteFromInput("Shelf A checked.\nShelf B locked."),
      "Shelf A checked.\nShelf B locked."
    );
  });
});
