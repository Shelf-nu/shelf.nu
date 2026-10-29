/**
 * Tests for how custom field values with links read on the asset screen.
 *
 * Fixtures have the shapes the mobile asset detail route sends (its route
 * test pins the same ones): `asset.customFields` entries with
 * `{ raw, valueText }` values, `asset.linkFields` definitions, and
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

import { containsLink, linkChip, splitLinkFields } from "./custom-field-links";

/** An `asset.customFields` entry for a TEXT field. */
function storedValue(fieldId: string, raw: string) {
  return {
    id: `acfv-${fieldId}`,
    value: { raw, valueText: raw },
    customField: { id: fieldId, name: fieldId, type: "TEXT" },
  };
}

const SERIAL = storedValue("cf-serial", "SN-0042");
const MANUAL = storedValue("cf-manual", "https://usa.canon.com/manual.pdf");
const CERT = storedValue("cf-cert", "   ");
const OLD_LINK = storedValue("cf-old-link", "https://x.com/a");

const LINK_FIELDS = [
  { id: "cf-cert", name: "Calibration certificate", helpText: null },
  { id: "cf-manual", name: "Manual", helpText: "Maker's PDF" },
  { id: "cf-warranty", name: "Warranty", helpText: null },
];

test("every listed Link field gets a row in the server's order, set or not", () => {
  const { linkRows } = splitLinkFields([SERIAL, MANUAL, CERT], LINK_FIELDS);
  assert.deepEqual(linkRows, [
    { id: "cf-cert", name: "Calibration certificate", value: null },
    {
      id: "cf-manual",
      name: "Manual",
      value: "https://usa.canon.com/manual.pdf",
    },
    { id: "cf-warranty", name: "Warranty", value: null },
  ]);
});

test("listed fields leave Custom Fields; every other value stays", () => {
  // cf-old-link is not in linkFields (its field no longer applies to the
  // asset's category), so it must stay visible in Custom Fields.
  const { otherFields } = splitLinkFields(
    [SERIAL, MANUAL, CERT, OLD_LINK],
    LINK_FIELDS
  );
  assert.deepEqual(
    otherFields.map((cf) => cf.customField.id),
    ["cf-serial", "cf-old-link"]
  );
});

test("an older server without linkFields leaves every value in Custom Fields", () => {
  for (const linkFields of [undefined, []]) {
    const { linkRows, otherFields } = splitLinkFields(
      [SERIAL, MANUAL],
      linkFields
    );
    assert.deepEqual(linkRows, []);
    assert.deepEqual(
      otherFields.map((cf) => cf.customField.id),
      ["cf-serial", "cf-manual"]
    );
  }
});

test("a value stored as a bare string still fills its row", () => {
  const { linkRows } = splitLinkFields(
    [{ value: "https://x.com/a", customField: { id: "cf-manual" } }],
    [{ id: "cf-manual", name: "Manual" }]
  );
  assert.deepEqual(linkRows, [
    { id: "cf-manual", name: "Manual", value: "https://x.com/a" },
  ]);
});

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
