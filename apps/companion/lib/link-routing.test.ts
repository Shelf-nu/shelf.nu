/**
 * Tests for the split between expo-router and the JS deep-link hook.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./link-routing.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isOpenedByRouter } from "./link-routing";

const WEB_ASSET = "https://app.shelf.nu/assets/as_1/overview";
const WEB_QR = "https://app.shelf.nu/qr/qr_1";
const SCHEME_ASSET = "shelf://assets/as_1";

test("the hook opens a web link that launches the app on iOS", () => {
  assert.equal(
    isOpenedByRouter({
      url: WEB_ASSET,
      linkType: "asset",
      initial: true,
      platform: "ios",
    }),
    false
  );
});

test("the router opens a web link that launches the app on Android", () => {
  assert.equal(
    isOpenedByRouter({
      url: WEB_ASSET,
      linkType: "asset",
      initial: true,
      platform: "android",
    }),
    true
  );
});

test("the router opens a web link that arrives while the app runs, on both platforms", () => {
  for (const platform of ["ios", "android"]) {
    assert.equal(
      isOpenedByRouter({
        url: WEB_ASSET,
        linkType: "asset",
        initial: false,
        platform,
      }),
      true,
      platform
    );
  }
});

test("the hook always opens a QR link, which needs an API resolve", () => {
  for (const initial of [true, false]) {
    for (const platform of ["ios", "android"]) {
      assert.equal(
        isOpenedByRouter({ url: WEB_QR, linkType: "qr", initial, platform }),
        false,
        `${platform} initial=${initial}`
      );
    }
  }
});

test("the hook always opens a custom-scheme link", () => {
  for (const initial of [true, false]) {
    for (const platform of ["ios", "android"]) {
      assert.equal(
        isOpenedByRouter({
          url: SCHEME_ASSET,
          linkType: "asset",
          initial,
          platform,
        }),
        false,
        `${platform} initial=${initial}`
      );
    }
  }
});
