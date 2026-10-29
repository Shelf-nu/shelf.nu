/**
 * Tests for `parseLink`: provider, kind, file name and icon read from
 * real-shaped share links, plus the link key and what is not one link.
 *
 * @see ./parse.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLink } from "./index";
import type { ParsedLink } from "./index";

type Reading = Pick<
  ParsedLink,
  "host" | "provider" | "kind" | "fileName" | "icon"
>;

const READINGS: readonly (readonly [string, Reading])[] = [
  [
    "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12dEf34GhI?e=x1Y2z3",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "pdf",
      fileName: null,
      icon: "pdf",
    },
  ],
  [
    "https://contoso.sharepoint.com/:w:/r/sites/Lab/_layouts/15/Doc.aspx?sourcedoc=%7B0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9%7D&file=Calibration%20procedure.docx&action=default&mobileredirect=true",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "document",
      fileName: "Calibration procedure.docx",
      icon: "document",
    },
  ],
  [
    "https://contoso.sharepoint.com/:x:/s/Lab/EXcEl123?e=AbCdEf",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "spreadsheet",
      fileName: null,
      icon: "spreadsheet",
    },
  ],
  [
    "https://contoso.sharepoint.com/:p:/s/Lab/EPpT456?e=Q1w2E3",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "presentation",
      fileName: null,
      icon: "presentation",
    },
  ],
  [
    "https://contoso.sharepoint.com/:f:/s/Lab/EmFoLdEr789?e=Zz9Yy8",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "folder",
      fileName: null,
      icon: "folder",
    },
  ],
  [
    "https://contoso.sharepoint.com/:i:/s/Lab/EiMaGe01?e=a1",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "image",
      fileName: null,
      icon: "image",
    },
  ],
  [
    "https://contoso.sharepoint.com/:v:/s/Lab/EvIdEo02?e=b2",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "video",
      fileName: null,
      icon: "video",
    },
  ],
  [
    "https://contoso.sharepoint.com/:u:/s/Lab/EfIlE03?e=c3",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "file",
      fileName: null,
      icon: "file",
    },
  ],
  [
    "https://contoso.sharepoint.com/sites/Lab/Shared%20Documents/Manuals/Torque%20wrench.pdf",
    {
      host: "contoso.sharepoint.com",
      provider: "sharepoint",
      kind: "pdf",
      fileName: "Torque wrench.pdf",
      icon: "pdf",
    },
  ],
  [
    "https://contoso-my.sharepoint.com/:f:/g/personal/jane_doe_contoso_com/EkF0lDeR?e=AbC123",
    {
      host: "contoso-my.sharepoint.com",
      provider: "onedrive",
      kind: "folder",
      fileName: null,
      icon: "folder",
    },
  ],
  [
    "https://1drv.ms/b/s!AkPdFxYz123?e=xyz789",
    {
      host: "1drv.ms",
      provider: "onedrive",
      kind: "pdf",
      fileName: null,
      icon: "pdf",
    },
  ],
  [
    "https://1drv.ms/x/c/0a1b2c3d4e5f6a7b/EXcElItEm?e=Q9",
    {
      host: "1drv.ms",
      provider: "onedrive",
      kind: "spreadsheet",
      fileName: null,
      icon: "spreadsheet",
    },
  ],
  [
    "https://onedrive.live.com/?cid=0A1B2C3D4E5F6A7B&id=0A1B2C3D4E5F6A7B%21123",
    {
      host: "onedrive.live.com",
      provider: "onedrive",
      kind: "page",
      fileName: null,
      icon: "link",
    },
  ],
  [
    "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing",
    {
      host: "drive.google.com",
      provider: "google-drive",
      kind: "file",
      fileName: null,
      icon: "file",
    },
  ],
  [
    "https://drive.google.com/drive/folders/1FoLdErIdXyZ?usp=drive_link",
    {
      host: "drive.google.com",
      provider: "google-drive",
      kind: "folder",
      fileName: null,
      icon: "folder",
    },
  ],
  [
    "https://drive.google.com/drive/u/0/folders/1FoLdErIdXyZ",
    {
      host: "drive.google.com",
      provider: "google-drive",
      kind: "folder",
      fileName: null,
      icon: "folder",
    },
  ],
  [
    "https://drive.google.com/open?id=1AbCdEfGhIjK",
    {
      host: "drive.google.com",
      provider: "google-drive",
      kind: "file",
      fileName: null,
      icon: "file",
    },
  ],
  [
    "https://docs.google.com/document/d/1DoCiDaBc/edit?usp=sharing",
    {
      host: "docs.google.com",
      provider: "google-docs",
      kind: "document",
      fileName: null,
      icon: "document",
    },
  ],
  [
    "https://docs.google.com/spreadsheets/d/1ShEeTiDaBc/edit?gid=0#gid=0",
    {
      host: "docs.google.com",
      provider: "google-docs",
      kind: "spreadsheet",
      fileName: null,
      icon: "spreadsheet",
    },
  ],
  [
    "https://docs.google.com/presentation/d/1SlIdEsIdAbC/edit#slide=id.p",
    {
      host: "docs.google.com",
      provider: "google-docs",
      kind: "presentation",
      fileName: null,
      icon: "presentation",
    },
  ],
  [
    "https://docs.google.com/forms/d/e/1FAIpQLSfOrMiDaBc/viewform?usp=sf_link",
    {
      host: "docs.google.com",
      provider: "google-docs",
      kind: "form",
      fileName: null,
      icon: "form",
    },
  ],
  [
    "https://www.dropbox.com/scl/fi/a1b2c3d4e5/Cal%20cert%202026.pdf?rlkey=x9y8z7&dl=0",
    {
      host: "dropbox.com",
      provider: "dropbox",
      kind: "pdf",
      fileName: "Cal cert 2026.pdf",
      icon: "pdf",
    },
  ],
  [
    "https://www.dropbox.com/scl/fi/k1l2m3n4o5/readme?rlkey=r1&dl=0",
    {
      host: "dropbox.com",
      provider: "dropbox",
      kind: "file",
      fileName: null,
      icon: "file",
    },
  ],
  [
    "https://www.dropbox.com/scl/fo/f6g7h8i9/AAbBcCdD?rlkey=q1w2e3&dl=0",
    {
      host: "dropbox.com",
      provider: "dropbox",
      kind: "folder",
      fileName: null,
      icon: "folder",
    },
  ],
  [
    "https://www.dropbox.com/s/abc123xyz/Service%20manual.docx?dl=0",
    {
      host: "dropbox.com",
      provider: "dropbox",
      kind: "document",
      fileName: "Service manual.docx",
      icon: "document",
    },
  ],
  [
    "https://app.box.com/file/1234567890",
    {
      host: "app.box.com",
      provider: "box",
      kind: "file",
      fileName: null,
      icon: "file",
    },
  ],
  [
    "https://acme.app.box.com/folder/987654321",
    {
      host: "acme.app.box.com",
      provider: "box",
      kind: "folder",
      fileName: null,
      icon: "folder",
    },
  ],
  [
    "https://app.box.com/s/abcdef123456",
    {
      host: "app.box.com",
      provider: "box",
      kind: "page",
      fileName: null,
      icon: "link",
    },
  ],
  [
    "https://usa.canon.com/manual.pdf",
    {
      host: "usa.canon.com",
      provider: null,
      kind: "pdf",
      fileName: "manual.pdf",
      icon: "pdf",
    },
  ],
  [
    "https://example.com/files/Asset%20register%202026.XLSX",
    {
      host: "example.com",
      provider: null,
      kind: "spreadsheet",
      fileName: "Asset register 2026.XLSX",
      icon: "spreadsheet",
    },
  ],
  [
    "https://www.bhphotovideo.com/c/product/1547009-REG/canon_eos_r5_mirrorless_camera.html",
    {
      host: "bhphotovideo.com",
      provider: null,
      kind: "page",
      fileName: null,
      icon: "link",
    },
  ],
];

for (const [url, reading] of READINGS) {
  test(`parseLink reads ${url}`, () => {
    const link = parseLink(url);
    assert.ok(link, "parses as one link");
    const { host, provider, kind, fileName, icon } = link;
    assert.deepEqual({ host, provider, kind, fileName, icon }, reading);
  });
}

test("parseLink keeps the trimmed value as the url", () => {
  const link = parseLink("  https://usa.canon.com/manual.pdf \n");
  assert.equal(link?.url, "https://usa.canon.com/manual.pdf");
  assert.equal(link?.key, "https://usa.canon.com/manual.pdf");
});

test("parseLink keys a link without its fragment", () => {
  const link = parseLink(
    "https://docs.google.com/spreadsheets/d/1ShEeTiDaBc/edit?gid=0#gid=0"
  );
  assert.equal(
    link?.key,
    "https://docs.google.com/spreadsheets/d/1ShEeTiDaBc/edit?gid=0"
  );
});

test("parseLink keys a link without Shelf's ref param, other params kept in order", () => {
  assert.equal(
    parseLink("https://example.com/manual.pdf?b=2&ref=shelf-webapp&a=1")?.key,
    "https://example.com/manual.pdf?b=2&a=1"
  );
  assert.equal(
    parseLink("https://example.com/manual.pdf?ref=shelf-companion")?.key,
    "https://example.com/manual.pdf"
  );
  assert.equal(
    parseLink("https://example.com/manual.pdf?ref=newsletter")?.key,
    "https://example.com/manual.pdf?ref=newsletter"
  );
});

test("parseLink lowercases the host and keys the normalized URL", () => {
  const link = parseLink("HTTPS://WWW.Example.COM");
  assert.equal(link?.url, "HTTPS://WWW.Example.COM");
  assert.equal(link?.host, "example.com");
  assert.equal(link?.key, "https://www.example.com/");
});

test("parseLink drops the port from the host", () => {
  assert.equal(
    parseLink("http://intranet.example.org:8080/docs/")?.host,
    "intranet.example.org"
  );
});

test("parseLink strips bidi controls from a file name", () => {
  assert.equal(
    parseLink("https://example.com/Invoice%E2%80%AEfdp.pdf")?.fileName,
    "Invoicefdp.pdf"
  );
});

test("parseLink returns null for anything but exactly one http(s) URL", () => {
  const notOneLink = [
    "",
    "   ",
    "Manual: https://x.com/a (rev B)",
    "https://x.com/a https://y.com/b",
    "https://x.com/manual.pdf.",
    "(https://x.com/manual.pdf)",
    "www.canon.com/manual.pdf",
    "javascript:alert(1)",
    "ftp://files.example.com/manual.pdf",
    "mailto:service@example.com",
    "https://[::1/manual.pdf",
    `https://example.com/${"a".repeat(2048)}`,
  ];
  for (const value of notOneLink) {
    assert.equal(parseLink(value), null, JSON.stringify(value));
  }
});

test("parseLink accepts a URL of exactly MAX_LINK_LENGTH characters", () => {
  const url = `https://example.com/${"a".repeat(2048 - 20)}`;
  assert.equal(url.length, 2048);
  assert.equal(parseLink(url)?.url, url);
});
