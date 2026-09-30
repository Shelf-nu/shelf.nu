/**
 * Tests for the asset screen's free-units figure.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./asset-free-now.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveFreeNowFigure } from "./asset-free-now";

test("shows the server's Free now figure, not the reservation-aware available", () => {
  // 10 owned, 3 in custody, 4 reserved for later: 7 are on the shelf now.
  assert.deepEqual(resolveFreeNowFigure({ available: 3, freeNow: 7 }, 10), {
    value: 7,
    isFreeNow: true,
  });
});

test("keeps the older Available figure and label when the server sends no Free now", () => {
  assert.deepEqual(resolveFreeNowFigure({ available: 3 }, 10), {
    value: 3,
    isFreeNow: false,
  });
});

test("shows the whole pool as free when nothing is in custody, reserved or out", () => {
  assert.deepEqual(resolveFreeNowFigure(null, 10), {
    value: 10,
    isFreeNow: true,
  });
});

test("shows nothing when the asset has no quantity", () => {
  assert.deepEqual(resolveFreeNowFigure(undefined, null), {
    value: null,
    isFreeNow: true,
  });
});

test("shows a Free now of zero rather than falling back", () => {
  assert.deepEqual(resolveFreeNowFigure({ available: 0, freeNow: 0 }, 5), {
    value: 0,
    isFreeNow: true,
  });
});
