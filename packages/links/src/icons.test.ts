/**
 * Tests for `LINK_ICONS`: every icon a parsed link can carry is drawable.
 *
 * @see ./icons.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { LINK_ICONS, parseLink } from "./index";

const SVG_PATH_DATA = /^[Mm][\d\s.,MmLlHhVvCcSsQqTtAaZz-]*$/;

test("LINK_ICONS gives each kind's icon valid 24x24 path data", () => {
  const urls = [
    "https://x.com/a.pdf",
    "https://x.com/a.docx",
    "https://x.com/a.xlsx",
    "https://x.com/a.pptx",
    "https://docs.google.com/forms/d/e/1F/viewform",
    "https://drive.google.com/drive/folders/1F",
    "https://x.com/a.png",
    "https://x.com/a.mp4",
    "https://x.com/a.zip",
    "https://app.box.com/file/1",
    "https://x.com/product/1",
  ];
  const icons = urls.map((url) => parseLink(url)?.icon);
  assert.deepEqual(icons, [
    "pdf",
    "document",
    "spreadsheet",
    "presentation",
    "form",
    "folder",
    "image",
    "video",
    "archive",
    "file",
    "link",
  ]);
  for (const icon of icons) {
    assert.ok(icon);
    const data = LINK_ICONS[icon];
    assert.equal(data.viewBox, "0 0 24 24", icon);
    assert.notEqual(data.paths.length, 0, icon);
    for (const d of data.paths) assert.match(d, SVG_PATH_DATA, icon);
  }
});
