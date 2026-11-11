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

import {
  isOpenedByRouter,
  isWebUrl,
  launchAction,
  webLaunchRoute,
  type AppPlatform,
} from "./link-routing";

const WEB_ASSET = "https://app.shelf.nu/assets/as_1/overview";
const WEB_QR = "https://app.shelf.nu/qr/qr_1";
const SCHEME_ASSET = "shelf://assets/as_1";
const PLATFORMS: AppPlatform[] = ["ios", "android"];

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
  for (const platform of PLATFORMS) {
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
    for (const platform of PLATFORMS) {
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
    for (const platform of PLATFORMS) {
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

test("a web launch link opens the route the router's own mapping names", () => {
  assert.equal(webLaunchRoute(WEB_ASSET, "asset"), "/assets/as_1");
});

test("a web launch link keeps a nested kit id", () => {
  assert.equal(
    webLaunchRoute("https://app.shelf.nu/assets/kits/kt_1", "asset"),
    "/assets/kits/kt_1"
  );
});

test("a web launch link keeps its query", () => {
  assert.equal(
    webLaunchRoute("https://app.shelf.nu/assets/new?qrId=qr_1", "asset"),
    "/assets/new?qrId=qr_1"
  );
});

test("no web launch route for QR, custom-scheme, start-screen or unclaimed links", () => {
  assert.equal(webLaunchRoute(WEB_QR, "qr"), null);
  assert.equal(webLaunchRoute(SCHEME_ASSET, "asset"), null);
  assert.equal(webLaunchRoute("https://app.shelf.nu/", "unknown"), null);
  assert.equal(webLaunchRoute("https://app.shelf.nu/login", "unknown"), null);
});

test("launch: an iOS claimed web link opens its mapped route", () => {
  assert.deepEqual(
    launchAction({ url: WEB_ASSET, linkType: "asset", platform: "ios" }),
    { kind: "route", route: "/assets/as_1" }
  );
});

test("launch: a QR link opens through the hook on both platforms", () => {
  for (const platform of PLATFORMS) {
    assert.deepEqual(
      launchAction({ url: WEB_QR, linkType: "qr", platform }),
      { kind: "link" },
      platform
    );
  }
});

test("launch: a custom-scheme link opens through the hook on both platforms", () => {
  for (const platform of PLATFORMS) {
    assert.deepEqual(
      launchAction({ url: SCHEME_ASSET, linkType: "asset", platform }),
      { kind: "link" },
      platform
    );
  }
});

test("launch: a web link on Android is left to the router", () => {
  assert.deepEqual(
    launchAction({ url: WEB_ASSET, linkType: "asset", platform: "android" }),
    { kind: "none" }
  );
});

test("launch: an unknown or unclaimed web link opens nothing", () => {
  for (const platform of PLATFORMS) {
    assert.deepEqual(
      launchAction({
        url: "https://app.shelf.nu/login",
        linkType: "unknown",
        platform,
      }),
      { kind: "none" },
      platform
    );
    assert.deepEqual(
      launchAction({
        url: "https://app.shelf.nu/",
        linkType: "unknown",
        platform,
      }),
      { kind: "none" },
      platform
    );
  }
});

test("launch: an unknown custom-scheme link opens nothing", () => {
  assert.deepEqual(
    launchAction({
      url: "shelf://nowhere",
      linkType: "unknown",
      platform: "ios",
    }),
    { kind: "none" }
  );
});

test("a web URL is http or https, in any case", () => {
  assert.equal(isWebUrl("https://app.shelf.nu/assets/as_1"), true);
  assert.equal(isWebUrl("HTTP://app.shelf.nu"), true);
  assert.equal(isWebUrl("shelf://assets/as_1"), false);
});
