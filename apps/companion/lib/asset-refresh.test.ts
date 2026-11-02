/**
 * Tests for the cross-screen "this asset changed" signal.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./asset-refresh.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { assetChangeVersion, markAssetChanged } from "./asset-refresh";

test("an asset that was never marked has version 0", () => {
  assert.equal(assetChangeVersion("never-marked"), 0);
});

test("marking an asset moves its version and the any-asset version", () => {
  const seenOne = assetChangeVersion("a1");
  const seenAny = assetChangeVersion();
  markAssetChanged("a1");
  assert.notEqual(assetChangeVersion("a1"), seenOne);
  assert.notEqual(assetChangeVersion(), seenAny);
});

test("reading a version does not clear it, so every screen sees the change", () => {
  markAssetChanged("a2");
  const first = assetChangeVersion("a2");
  assert.equal(assetChangeVersion("a2"), first);
});

test("marking one asset leaves another asset's version alone", () => {
  markAssetChanged("a3");
  const other = assetChangeVersion("a3");
  markAssetChanged("a4");
  assert.equal(assetChangeVersion("a3"), other);
});
