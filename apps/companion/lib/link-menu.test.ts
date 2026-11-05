/**
 * Tests for the long-press menu of a link.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./link-menu.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLinkMenu } from "./link-menu";

const URL_ = "https://canon.com/r5.pdf";

test("iOS: an action sheet titled with the URL, Copy, Share, then Cancel", () => {
  assert.deepEqual(buildLinkMenu(URL_, { ios: true, canCopy: true }), {
    title: URL_,
    buttons: [
      { label: "Copy link", action: "copy" },
      { label: "Share", action: "share" },
      { label: "Cancel", action: null },
    ],
    cancelIndex: 2,
  });
});

test("Android: an alert titled with the URL, Cancel first", () => {
  assert.deepEqual(buildLinkMenu(URL_, { ios: false, canCopy: true }), {
    title: URL_,
    buttons: [
      { label: "Cancel", action: null },
      { label: "Copy link", action: "copy" },
      { label: "Share", action: "share" },
    ],
    cancelIndex: 0,
  });
});

test("without a clipboard module the menu offers Share only", () => {
  for (const ios of [true, false]) {
    const menu = buildLinkMenu(URL_, { ios, canCopy: false });
    assert.deepEqual(
      menu.buttons.map((button) => button.action),
      ios ? ["share", null] : [null, "share"]
    );
    assert.equal(menu.buttons[menu.cancelIndex]?.action, null);
  }
});
