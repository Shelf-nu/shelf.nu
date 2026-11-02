/**
 * Tests for the assets list's refresh and error-display rules.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./asset-list-refresh.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSET_LIST_FRESH_MS,
  listErrorView,
  planFocusRefresh,
} from "./asset-list-refresh";

const fresh = ASSET_LIST_FRESH_MS - 1;
const stale = ASSET_LIST_FRESH_MS;

test("the first focus loads page 1", () => {
  assert.equal(
    planFocusRefresh({
      hasFetched: false,
      ageMs: 0,
      assetChanged: false,
      loadedPages: 0,
    }),
    "reset"
  );
});

test("fresh rows with no change skip the fetch", () => {
  assert.equal(
    planFocusRefresh({
      hasFetched: true,
      ageMs: fresh,
      assetChanged: false,
      loadedPages: 3,
    }),
    "skip"
  );
});

test("stale rows start again from page 1", () => {
  assert.equal(
    planFocusRefresh({
      hasFetched: true,
      ageMs: stale,
      assetChanged: false,
      loadedPages: 3,
    }),
    "reset"
  );
});

test("an asset change bypasses freshness", () => {
  assert.equal(
    planFocusRefresh({
      hasFetched: true,
      ageMs: fresh,
      assetChanged: true,
      loadedPages: 1,
    }),
    "reset"
  );
});

test("an asset change keeps every loaded page", () => {
  assert.equal(
    planFocusRefresh({
      hasFetched: true,
      ageMs: fresh,
      assetChanged: true,
      loadedPages: 5,
    }),
    "reload-loaded"
  );
});

test("no error shows nothing", () => {
  assert.equal(listErrorView(null, 0), "none");
  assert.equal(listErrorView(null, 20), "none");
});

test("an error with no rows takes the whole screen", () => {
  assert.equal(listErrorView("Network error", 0), "screen");
});

test("an error over rows shows as a banner, not silently", () => {
  assert.equal(listErrorView("Network error", 20), "banner");
});
