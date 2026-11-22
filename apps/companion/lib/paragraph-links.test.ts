/**
 * Tests for the link chips under a description or note.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./paragraph-links.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_PARAGRAPH_CHIPS, paragraphLinks } from "./paragraph-links";
import { findTextLinks } from "./text-links";

const SERVER = "https://app.shelf.nu";

/** The chip URLs for a text, and whether the chip replaces the text. */
function read(text: string) {
  const { chips, onlyChip } = paragraphLinks(findTextLinks(text), SERVER);
  return { urls: chips.map((chip) => chip.url), onlyChip };
}

test("each outside link gets one chip, in order", () => {
  assert.deepEqual(
    read("Manual https://canon.com/r5.pdf and spares at adorama.com"),
    {
      urls: ["https://canon.com/r5.pdf", "https://adorama.com"],
      onlyChip: false,
    }
  );
});

test("the same link twice gets one chip", () => {
  assert.deepEqual(read("https://x.com/a then again https://x.com/a").urls, [
    "https://x.com/a",
  ]);
});

test("links to Shelf itself get no chip", () => {
  assert.deepEqual(
    read("Kit https://app.shelf.nu/kits/kt_1 and https://canon.com/r5.pdf")
      .urls,
    ["https://canon.com/r5.pdf"]
  );
  assert.deepEqual(read("See https://app.shelf.nu/bookings/bk_1"), {
    urls: [],
    onlyChip: false,
  });
});

test("the chips stop at the cap", () => {
  const text = Array.from(
    { length: MAX_PARAGRAPH_CHIPS + 3 },
    (_, index) => `https://site${index}.com`
  ).join(" ");
  assert.equal(read(text).urls.length, MAX_PARAGRAPH_CHIPS);
});

test("a text that is one outside link shows only its chip", () => {
  assert.deepEqual(read("  https://canon.com/r5.pdf \n"), {
    urls: ["https://canon.com/r5.pdf"],
    onlyChip: true,
  });
});

test("two different links keep the text", () => {
  assert.equal(read("https://a.com https://b.com").onlyChip, false);
});

test("a lone link with its own label keeps the text", () => {
  const { onlyChip } = paragraphLinks(
    [
      {
        type: "link",
        text: "Calibration instructions",
        url: "https://example.com/file.pdf",
      },
    ],
    SERVER
  );
  assert.equal(onlyChip, false);
});

test("a lone bare domain shows only its chip", () => {
  assert.equal(read("canon.com/r5.pdf").onlyChip, true);
});
