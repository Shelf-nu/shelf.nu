/**
 * Tests for `parseLinkInput`, the Link-format input rule.
 *
 * @see ./parse.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLink, parseLinkInput } from "./index";

const ACCEPTED: readonly (readonly [string, string])[] = [
  ["https://usa.canon.com/manual.pdf", "https://usa.canon.com/manual.pdf"],
  ["  https://usa.canon.com/manual.pdf \n", "https://usa.canon.com/manual.pdf"],
  ["http://intranet.example.org/manual", "http://intranet.example.org/manual"],
  ["www.canon.com/manual.pdf", "https://www.canon.com/manual.pdf"],
  ["canon.com", "https://canon.com"],
  ["example.com:8080/docs", "https://example.com:8080/docs"],
  ["HTTPS://Example.com/Manual.PDF", "HTTPS://Example.com/Manual.PDF"],
  ["https://usa.canon.com/manual.pdf.", "https://usa.canon.com/manual.pdf"],
  [
    "https://x.com/wiki/Mercury_(planet)",
    "https://x.com/wiki/Mercury_(planet)",
  ],
];

for (const [input, url] of ACCEPTED) {
  test(`parseLinkInput accepts ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseLinkInput(input), { ok: true, url });
  });
}

test("parseLinkInput: every accepted url reads back as one link", () => {
  for (const [input] of ACCEPTED) {
    const result = parseLinkInput(input);
    assert.ok(result.ok, input);
    assert.equal(parseLink(result.url)?.url, result.url, input);
  }
});

const ENTER_A_LINK = "Enter a web link, like https://example.com/manual.pdf";
const NO_SPACES = "Enter just the link, with no spaces or other text";
const WEB_ONLY = "Use a web link that starts with https:// or http://";

const REFUSED: readonly (readonly [string, string])[] = [
  ["", ENTER_A_LINK],
  ["   ", ENTER_A_LINK],
  ["notalink", ENTER_A_LINK],
  ["https://localhost/manual.pdf", ENTER_A_LINK],
  ["//example.com/manual.pdf", ENTER_A_LINK],
  ["https:///example.com/manual.pdf", ENTER_A_LINK],
  ["https:example.com", ENTER_A_LINK],
  ["https://exa<mple.com/a", ENTER_A_LINK],
  ["https://example.com:99999/a", ENTER_A_LINK],
  ["see shelf", NO_SPACES],
  ["Manual: https://x.com/a.pdf", NO_SPACES],
  ["https://x.com/my manual.pdf", NO_SPACES],
  ["javascript:alert(1)", WEB_ONLY],
  ["ftp://files.example.com/manual.pdf", WEB_ONLY],
  ["mailto:service@example.com", WEB_ONLY],
];

for (const [input, message] of REFUSED) {
  test(`parseLinkInput refuses ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseLinkInput(input), { ok: false, message });
  });
}

test("parseLinkInput refuses a link longer than MAX_LINK_LENGTH", () => {
  assert.deepEqual(parseLinkInput(`example.com/${"a".repeat(2048)}`), {
    ok: false,
    message: "Links can be at most 2048 characters long",
  });
});
