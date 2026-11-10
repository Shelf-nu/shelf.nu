/**
 * Guards the package sources against literal bidi control characters: they
 * reorder how the code reads in an editor or a review, so a character class
 * that holds them hides what it matches. Sources spell them as `\u` escapes.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

test("no source file in @shelf/links holds a literal bidi control character", () => {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  assert.ok(files.includes("display-text.ts"), "scans the package sources");
  for (const name of files) {
    const source = readFileSync(join(dir, name), "utf8");
    const found = BIDI_CONTROL.exec(source);
    assert.equal(
      found && `U+${found[0].codePointAt(0)?.toString(16).toUpperCase()}`,
      null,
      `${name} holds a literal bidi control character`
    );
  }
});
