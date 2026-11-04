/**
 * Tests for finding links in text a person typed: explicit http(s) URLs and
 * conservative bare domains.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./text-links.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { findTextLinks } from "./text-links";

/** The link runs as `[typed text, url]` pairs, in order. */
function links(text: string) {
  return findTextLinks(text).flatMap((segment) =>
    segment.type === "link" ? [[segment.text, segment.url]] : []
  );
}

test("an explicit URL links as typed, without trailing punctuation", () => {
  assert.deepEqual(links("Manual: https://www.canon.com/r5.pdf."), [
    ["https://www.canon.com/r5.pdf", "https://www.canon.com/r5.pdf"],
  ]);
});

test("a bare domain links to https and keeps its path", () => {
  assert.deepEqual(links("Spec sheet at canon.com/r5-specs.pdf, page 4"), [
    ["canon.com/r5-specs.pdf", "https://canon.com/r5-specs.pdf"],
  ]);
});

test("www domains and subdomains link", () => {
  assert.deepEqual(links("see www.shelf.nu or docs.google.com/d/1"), [
    ["www.shelf.nu", "https://www.shelf.nu"],
    ["docs.google.com/d/1", "https://docs.google.com/d/1"],
  ]);
});

test("a bare domain at the end of a sentence drops the full stop", () => {
  assert.deepEqual(links("Order from bhphotovideo.com."), [
    ["bhphotovideo.com", "https://bhphotovideo.com"],
  ]);
});

test("a bare domain in parentheses drops the closing bracket", () => {
  assert.deepEqual(links("(spares at adorama.com)"), [
    ["adorama.com", "https://adorama.com"],
  ]);
});

test("the text around the links is kept byte for byte", () => {
  const text = "A canon.com B https://x.com/a C";
  assert.equal(
    findTextLinks(text)
      .map((segment) => segment.text)
      .join(""),
    text
  );
});

test("file names, versions and abbreviations stay text", () => {
  for (const text of [
    "see manual.pdf",
    "notes in README.md",
    "firmware v1.2.3",
    "bring cables, e.g. HDMI",
    "the script deploy.sh",
    "built with Node.js",
    "photos.zip attached",
    "the logo.ai file",
    "built in Xcode.app",
  ]) {
    assert.deepEqual(links(text), [], text);
  }
});

test("an e-mail address is not read as a domain", () => {
  assert.deepEqual(links("mail lab@acme.com or john.smith@acme.co.uk"), []);
  // The local part ends in a listed domain, so only the "@" after it tells.
  assert.deepEqual(links("write to sales.co@acme.com"), []);
});

test("a missed space after a full stop does not make a link", () => {
  for (const text of [
    "Lens returned damaged.No charger",
    "Fixed it.It works now",
    "Checked twice.Com port is fine",
    "send it.no rush",
  ]) {
    assert.deepEqual(links(text), [], text);
  }
});

test("a domain followed by more word characters is not linked", () => {
  assert.deepEqual(links("lens.de-fogged and rig.com_backup"), []);
  assert.deepEqual(links("example.com2 and example.com.x"), []);
  assert.deepEqual(links("example.com.中国 and example.comの"), []);
});

test("a domain glued to another word or path is not linked", () => {
  assert.deepEqual(links("path/to/canon.com and old_canon.com"), []);
});

test("an explicit URL is not linked twice as a bare domain", () => {
  assert.deepEqual(links("https://canon.com/support"), [
    ["https://canon.com/support", "https://canon.com/support"],
  ]);
});

test("a port and query on a bare domain survive", () => {
  assert.deepEqual(links("intranet.acme.com:8443/wiki?page=2"), [
    [
      "intranet.acme.com:8443/wiki?page=2",
      "https://intranet.acme.com:8443/wiki?page=2",
    ],
  ]);
});
