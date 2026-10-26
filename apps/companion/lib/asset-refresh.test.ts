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

import { consumeAssetDirty, markAssetDirty } from "./asset-refresh";

test("a marked asset is reported once, then cleared", () => {
  markAssetDirty("a1");
  assert.equal(consumeAssetDirty("a1"), true);
  assert.equal(consumeAssetDirty("a1"), false);
});

test("an asset that was never marked is not reported", () => {
  assert.equal(consumeAssetDirty("never-marked"), false);
});

test("two marked assets are kept apart", () => {
  markAssetDirty("a2");
  markAssetDirty("a3");
  assert.equal(consumeAssetDirty("a3"), true);
  assert.equal(consumeAssetDirty("a2"), true);
});
