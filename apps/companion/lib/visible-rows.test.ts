/**
 * Tests for the inline dropdowns' row cap.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./visible-rows.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_DROPDOWN_ROWS, moreRowsHint, visibleRows } from "./visible-rows";

test("draws every row when they fit", () => {
  const items = Array.from({ length: 12 }, (_, i) => i);

  assert.deepEqual(visibleRows(items), { rows: items, hiddenCount: 0 });
});

test("draws the first rows and counts the rest", () => {
  const items = Array.from({ length: 654 }, (_, i) => i);

  const { rows, hiddenCount } = visibleRows(items);

  assert.equal(rows.length, MAX_DROPDOWN_ROWS);
  assert.equal(rows[0], 0);
  assert.equal(hiddenCount, 654 - MAX_DROPDOWN_ROWS);
});

test("words the hint like the web pickers", () => {
  assert.equal(
    moreRowsHint(50, 127),
    "Showing 50 out of 127, type to search for more"
  );
});
