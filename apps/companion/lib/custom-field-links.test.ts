/**
 * Tests for how custom field values with links read on the asset screen.
 *
 * Fixtures have the shapes the mobile asset detail route sends (its route
 * test pins the same ones): `{ raw, valueText }` text values, and
 * `asset.fieldLinkTitles` keyed by custom field id, each with a page title
 * and a custom title.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./custom-field-links.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { containsLink, linkChip } from "./custom-field-links";

test("a SharePoint PDF share link with no title reads its kind and provider", () => {
  assert.deepEqual(
    linkChip("https://contoso.sharepoint.com/:b:/s/Lab/Eab?e=1", undefined),
    {
      primary: "PDF",
      meta: "SharePoint",
      label: "PDF, SharePoint",
      url: "https://contoso.sharepoint.com/:b:/s/Lab/Eab?e=1",
      icon: "pdf",
    }
  );
});

test("a fetched page title leads the chip", () => {
  const fieldLinkTitles = {
    "cf-shop": { pageTitle: "Canon EOS R5", customTitle: null },
  };
  assert.deepEqual(
    linkChip(
      "https://www.bhphotovideo.com/c/product/123#specs",
      fieldLinkTitles["cf-shop"]
    ),
    {
      primary: "Canon EOS R5",
      meta: "bhphotovideo.com",
      label: "Canon EOS R5, bhphotovideo.com",
      url: "https://www.bhphotovideo.com/c/product/123#specs",
      icon: "link",
    }
  );
});

test("a name given in the workspace wins over the page title", () => {
  const title = {
    pageTitle: "EOS R5 Instruction Manual",
    customTitle: "R5 manual (rev B)",
  };
  assert.deepEqual(linkChip("https://usa.canon.com/manual.pdf", title), {
    primary: "R5 manual (rev B)",
    meta: "PDF · usa.canon.com",
    label: "R5 manual (rev B), PDF, usa.canon.com",
    url: "https://usa.canon.com/manual.pdf",
    icon: "pdf",
  });
});

test("a field's title reaches a link whose host is not ASCII", () => {
  // The server keys this link by its punycode host, which the URL
  // implementation on the phone does not produce; the field id needs no key.
  const fieldLinkTitles = {
    "cf-handbook": { pageTitle: "Handbuch EOS R5", customTitle: null },
  };
  assert.equal(
    linkChip(
      "https://bücher.example/Handbuch.pdf",
      fieldLinkTitles["cf-handbook"]
    )?.primary,
    "Handbuch EOS R5"
  );
});

test("a Dropbox file shows its file name when no title is known", () => {
  assert.equal(
    linkChip(
      "https://www.dropbox.com/scl/fi/abc/Cal%20cert%202026.pdf?rlkey=x",
      undefined
    )?.label,
    "Cal cert 2026.pdf, PDF, Dropbox"
  );
});

test("text around a link is not a chip", () => {
  assert.equal(linkChip("Manual: https://x.com/a (rev B)", undefined), null);
  assert.equal(linkChip("see the binder", undefined), null);
});

test("a value needs link room when a URL appears anywhere in it", () => {
  assert.equal(containsLink("https://x.com/a"), true);
  assert.equal(containsLink("Manual: https://x.com/a (rev B)"), true);
  assert.equal(containsLink("Shelf 3, bin 12"), false);
  assert.equal(containsLink("www.example.com/manual.pdf"), false);
  assert.equal(containsLink("javascript:alert(1)"), false);
});
