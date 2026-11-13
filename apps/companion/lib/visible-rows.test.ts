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

import {
  DROPDOWN_MAX_HEIGHT,
  DROPDOWN_PART_HEIGHTS,
  MAX_DROPDOWN_ROWS,
  MIN_VISIBLE_DROPDOWN_ROWS,
  incompleteListNotice,
  moreRowsHint,
  visibleRows,
} from "./visible-rows";

/** `count` rows with ids "row-0", "row-1", ... in list order. */
const rowsOf = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }));

test("draws every row when they fit", () => {
  const items = rowsOf(12);

  assert.deepEqual(visibleRows(items), { rows: items, hiddenCount: 0 });
});

test("draws the first rows and counts the rest", () => {
  const items = rowsOf(654);

  const { rows, hiddenCount } = visibleRows(items);

  assert.equal(rows.length, MAX_DROPDOWN_ROWS);
  assert.equal(rows[0].id, "row-0");
  assert.equal(hiddenCount, 654 - MAX_DROPDOWN_ROWS);
});

test("draws the selected row first when it sorts after the cap", () => {
  const items = rowsOf(120);

  const { rows, hiddenCount } = visibleRows(items, "row-97");

  assert.equal(rows.length, MAX_DROPDOWN_ROWS + 1);
  assert.equal(rows[0].id, "row-97");
  assert.equal(rows[1].id, "row-0");
  assert.equal(hiddenCount, 120 - rows.length);
});

test("does not repeat a selected row that is already drawn", () => {
  const items = rowsOf(120);

  const { rows } = visibleRows(items, "row-3");

  assert.equal(rows.length, MAX_DROPDOWN_ROWS);
  assert.equal(rows.filter((row) => row.id === "row-3").length, 1);
});

test("draws a selected row just past the cap first", () => {
  const items = rowsOf(MAX_DROPDOWN_ROWS + 1);

  const { rows, hiddenCount } = visibleRows(items, `row-${MAX_DROPDOWN_ROWS}`);

  assert.equal(rows[0].id, `row-${MAX_DROPDOWN_ROWS}`);
  assert.equal(rows.length, MAX_DROPDOWN_ROWS + 1);
  assert.equal(hiddenCount, 0);
});

test("hides nothing when the rows exactly fill the cap", () => {
  const { rows, hiddenCount } = visibleRows(rowsOf(MAX_DROPDOWN_ROWS), null);

  assert.equal(rows.length, MAX_DROPDOWN_ROWS);
  assert.equal(hiddenCount, 0);
});

test("is tall enough for the search box, four rows and the clear row", () => {
  const { search, row, clear } = DROPDOWN_PART_HEIGHTS;

  assert.ok(MIN_VISIBLE_DROPDOWN_ROWS >= 4);
  assert.ok(
    DROPDOWN_MAX_HEIGHT >= search + MIN_VISIBLE_DROPDOWN_ROWS * row + clear
  );
});

test("leaves out a selected row the search does not match", () => {
  // The caller passes only the rows that match the search.
  const matches = rowsOf(60);

  const { rows } = visibleRows(matches, "row-500");

  assert.equal(rows.length, MAX_DROPDOWN_ROWS);
});

test("words the hint like the web pickers", () => {
  assert.equal(
    moreRowsHint(50, 127),
    "Showing 50 out of 127, type to search for more"
  );
});

test("has no notice for a complete list", () => {
  assert.equal(
    incompleteListNotice({
      noun: "locations",
      error: null,
      truncated: false,
      loaded: 120,
    }),
    null
  );
});

test("offers a retry when a page failed to load", () => {
  assert.deepEqual(
    incompleteListNotice({
      noun: "locations",
      error: "Network error",
      truncated: false,
      loaded: 100,
    }),
    { message: "Couldn't load all locations.", canRetry: true }
  );
});

test("offers the retry when a list both failed and was cut off", () => {
  assert.deepEqual(
    incompleteListNotice({
      noun: "locations",
      error: "Network error",
      truncated: true,
      loaded: 100,
    }),
    { message: "Couldn't load all locations.", canRetry: true }
  );
});

test("says how many rows are listed when the load hit its limit", () => {
  assert.deepEqual(
    incompleteListNotice({
      noun: "locations",
      error: null,
      truncated: true,
      loaded: 5000,
    }),
    { message: "Only the first 5000 locations are listed.", canRetry: false }
  );
});
