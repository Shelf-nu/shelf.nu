/**
 * Tests for `segmentText`: which characters of a text value become a link.
 *
 * @see ./parse.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { segmentText } from "./index";

test("segmentText links only the URL inside surrounding text", () => {
  assert.deepEqual(segmentText("Manual: https://x.com/a.pdf (rev B)"), [
    { type: "text", text: "Manual: " },
    { type: "link", text: "https://x.com/a.pdf", url: "https://x.com/a.pdf" },
    { type: "text", text: " (rev B)" },
  ]);
});

test("segmentText returns a lone URL as one link segment", () => {
  assert.deepEqual(segmentText("https://usa.canon.com/manual.pdf"), [
    {
      type: "link",
      text: "https://usa.canon.com/manual.pdf",
      url: "https://usa.canon.com/manual.pdf",
    },
  ]);
});

test("segmentText leaves trailing sentence punctuation out of the link", () => {
  assert.deepEqual(segmentText("See https://x.com/a. Then call."), [
    { type: "text", text: "See " },
    { type: "link", text: "https://x.com/a", url: "https://x.com/a" },
    { type: "text", text: ". Then call." },
  ]);
  assert.deepEqual(segmentText(`Is it "https://x.com/a?"!`), [
    { type: "text", text: `Is it "` },
    { type: "link", text: "https://x.com/a", url: "https://x.com/a" },
    { type: "text", text: `?"!` },
  ]);
  assert.deepEqual(segmentText("'https://x.com/a',"), [
    { type: "text", text: "'" },
    { type: "link", text: "https://x.com/a", url: "https://x.com/a" },
    { type: "text", text: "'," },
  ]);
});

test("segmentText drops an unbalanced closing parenthesis or bracket", () => {
  assert.deepEqual(segmentText("(see https://x.com/a)."), [
    { type: "text", text: "(see " },
    { type: "link", text: "https://x.com/a", url: "https://x.com/a" },
    { type: "text", text: ")." },
  ]);
  assert.deepEqual(segmentText("[https://x.com/a]"), [
    { type: "text", text: "[" },
    { type: "link", text: "https://x.com/a", url: "https://x.com/a" },
    { type: "text", text: "]" },
  ]);
});

test("segmentText keeps balanced parentheses inside the URL", () => {
  const url = "https://en.wikipedia.org/wiki/Mercury_(planet)";
  assert.deepEqual(segmentText(`(${url})`), [
    { type: "text", text: "(" },
    { type: "link", text: url, url },
    { type: "text", text: ")" },
  ]);
});

test("segmentText finds two URLs on one line and across lines", () => {
  assert.deepEqual(
    segmentText(
      "Front: https://a.com/1 back: https://b.com/2\nCert https://c.com/3"
    ),
    [
      { type: "text", text: "Front: " },
      { type: "link", text: "https://a.com/1", url: "https://a.com/1" },
      { type: "text", text: " back: " },
      { type: "link", text: "https://b.com/2", url: "https://b.com/2" },
      { type: "text", text: "\nCert " },
      { type: "link", text: "https://c.com/3", url: "https://c.com/3" },
    ]
  );
});

test("segmentText finds the URL inside markdown-style link text", () => {
  assert.deepEqual(segmentText("[Manual](https://x.com/manual.pdf)"), [
    { type: "text", text: "[Manual](" },
    {
      type: "link",
      text: "https://x.com/manual.pdf",
      url: "https://x.com/manual.pdf",
    },
    { type: "text", text: ")" },
  ]);
  assert.deepEqual(segmentText("<https://x.com/a>"), [
    { type: "text", text: "<" },
    { type: "link", text: "https://x.com/a", url: "https://x.com/a" },
    { type: "text", text: ">" },
  ]);
});

test("segmentText leaves other schemes and bare hosts as text", () => {
  for (const text of [
    "javascript:alert(1)",
    "JavaScript:alert('x')",
    "data:text/html,<b>hi</b>",
    "ftp://files.example.com/manual.pdf",
    "Call www.canon.com for the manual",
  ]) {
    assert.deepEqual(segmentText(text), [{ type: "text", text }], text);
  }
});

test("segmentText keeps a candidate the URL parser rejects as text", () => {
  const text = "Broken https://[::1/manual here, fixed https://x.com/a";
  assert.deepEqual(segmentText(text), [
    { type: "text", text: "Broken https://[::1/manual here, fixed " },
    { type: "link", text: "https://x.com/a", url: "https://x.com/a" },
  ]);
});

test("segmentText keeps a URL longer than MAX_LINK_LENGTH as text", () => {
  const text = `Spec https://example.com/${"a".repeat(2048)}`;
  assert.deepEqual(segmentText(text), [{ type: "text", text }]);
});

test("segmentText returns no segments for empty text", () => {
  assert.deepEqual(segmentText(""), []);
});
