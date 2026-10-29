/**
 * Tests for `linkChipText` (the words on a chip) and `cleanLinkTitle` (making
 * a fetched page title displayable).
 *
 * @see ./chip-text.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanLinkTitle, linkChipText, parseLink } from "./index";
import type { LinkTitle, ParsedLink } from "./index";

function link(url: string): ParsedLink {
  const parsed = parseLink(url);
  assert.ok(parsed, `${url} parses as one link`);
  return parsed;
}

function title(
  pageTitle: string | null,
  customTitle: string | null = null
): LinkTitle {
  return { pageTitle, customTitle };
}

test("linkChipText: SharePoint PDF share link without a title", () => {
  assert.deepEqual(
    linkChipText(
      link("https://contoso.sharepoint.com/:b:/s/Lab/Eab?e=1"),
      undefined
    ),
    { primary: "PDF", meta: "SharePoint", label: "PDF, SharePoint" }
  );
});

test("linkChipText: OneDrive for work folder", () => {
  assert.deepEqual(
    linkChipText(
      link("https://contoso-my.sharepoint.com/:f:/g/personal/x/EkF0lDeR?e=2"),
      undefined
    ),
    { primary: "Folder", meta: "OneDrive", label: "Folder, OneDrive" }
  );
});

test("linkChipText: Google Drive file and folder", () => {
  assert.deepEqual(
    linkChipText(link("https://drive.google.com/file/d/1AbC/view"), undefined),
    { primary: "File", meta: "Google Drive", label: "File, Google Drive" }
  );
  assert.deepEqual(
    linkChipText(
      link("https://drive.google.com/drive/folders/1FoLdEr"),
      undefined
    ),
    { primary: "Folder", meta: "Google Drive", label: "Folder, Google Drive" }
  );
});

test("linkChipText: the provider's own kind word", () => {
  assert.deepEqual(
    linkChipText(
      link("https://docs.google.com/spreadsheets/d/1ShEeT"),
      undefined
    ),
    {
      primary: "Google Sheet",
      meta: "Google Docs",
      label: "Google Sheet, Google Docs",
    }
  );
  assert.deepEqual(
    linkChipText(
      link("https://contoso.sharepoint.com/:w:/s/Lab/EwOrD?e=3"),
      undefined
    ),
    {
      primary: "Word document",
      meta: "SharePoint",
      label: "Word document, SharePoint",
    }
  );
});

test("linkChipText: Dropbox file name with kind and provider", () => {
  assert.deepEqual(
    linkChipText(
      link("https://www.dropbox.com/scl/fi/abc/Cal%20cert%202026.pdf?rlkey=x"),
      undefined
    ),
    {
      primary: "Cal cert 2026.pdf",
      meta: "PDF · Dropbox",
      label: "Cal cert 2026.pdf, PDF, Dropbox",
    }
  );
});

test("linkChipText: file name on a plain host", () => {
  assert.deepEqual(
    linkChipText(link("https://usa.canon.com/manual.pdf"), title(null)),
    {
      primary: "manual.pdf",
      meta: "PDF · usa.canon.com",
      label: "manual.pdf, PDF, usa.canon.com",
    }
  );
});

test("linkChipText: a plain page shows its host once", () => {
  assert.deepEqual(
    linkChipText(link("https://www.bhphotovideo.com/c/product/123"), undefined),
    { primary: "bhphotovideo.com", meta: null, label: "bhphotovideo.com" }
  );
});

test("linkChipText: a page title replaces the host", () => {
  assert.deepEqual(
    linkChipText(
      link("https://www.bhphotovideo.com/c/product/123"),
      title("Canon EOS R5")
    ),
    {
      primary: "Canon EOS R5",
      meta: "bhphotovideo.com",
      label: "Canon EOS R5, bhphotovideo.com",
    }
  );
});

test("linkChipText: a custom title wins over the page title and file name", () => {
  assert.deepEqual(
    linkChipText(
      link("https://usa.canon.com/manual.pdf"),
      title("EOS R5 Instruction Manual", "EOS R5 user manual")
    ),
    {
      primary: "EOS R5 user manual",
      meta: "PDF · usa.canon.com",
      label: "EOS R5 user manual, PDF, usa.canon.com",
    }
  );
});

test("linkChipText: a blank custom title falls back to the page title", () => {
  assert.equal(
    linkChipText(
      link("https://usa.canon.com/manual.pdf"),
      title("EOS R5 manual", "")
    ).primary,
    "EOS R5 manual"
  );
});

test("linkChipText: a provider page without a kind shows host and provider", () => {
  assert.deepEqual(
    linkChipText(link("https://app.box.com/s/abcdef"), undefined),
    {
      primary: "app.box.com",
      meta: "Box",
      label: "app.box.com, Box",
    }
  );
});

const drive = link("https://drive.google.com/file/d/1AbC/view");
const shop = link("https://www.bhphotovideo.com/c/product/123");

test("cleanLinkTitle collapses whitespace and trims", () => {
  assert.equal(
    cleanLinkTitle("\n   EOS R5\n\tuser   manual  "),
    "EOS R5 user manual"
  );
});

test("cleanLinkTitle turns control characters into spaces", () => {
  assert.equal(
    cleanLinkTitle("\u0000Torque\u0007wrench\u009f"),
    "Torque wrench"
  );
});

test("cleanLinkTitle strips bidi override and isolate characters", () => {
  assert.equal(
    cleanLinkTitle("Invoice \u202Efdp.exe\u202C \u2066x\u2069\u200F"),
    "Invoice fdp.exe x"
  );
});

test("cleanLinkTitle removes the Google Drive suffix only for a Drive link", () => {
  assert.equal(
    cleanLinkTitle("Manual.pdf - Google Drive", drive),
    "Manual.pdf"
  );
  assert.equal(
    cleanLinkTitle("Manual.pdf - Google Drive", shop),
    "Manual.pdf - Google Drive"
  );
  assert.equal(
    cleanLinkTitle("Manual.pdf - Google Drive"),
    "Manual.pdf - Google Drive"
  );
});

test("cleanLinkTitle caps the title at 120 characters", () => {
  assert.equal(cleanLinkTitle("x".repeat(130)), "x".repeat(120));
  assert.equal(cleanLinkTitle(`${"a".repeat(119)} tail`), "a".repeat(119));
  assert.equal(cleanLinkTitle("📄".repeat(130)), "📄".repeat(120));
});

test("cleanLinkTitle returns null when nothing useful is left", () => {
  assert.equal(cleanLinkTitle(""), null);
  assert.equal(cleanLinkTitle(" \n\t "), null);
  assert.equal(cleanLinkTitle("\u202E\u2066"), null);
  assert.equal(cleanLinkTitle("bhphotovideo.com", shop), null);
  assert.equal(cleanLinkTitle("www.BHPhotoVideo.com", shop), null);
  assert.equal(cleanLinkTitle("bhphotovideo.com"), "bhphotovideo.com");
});
