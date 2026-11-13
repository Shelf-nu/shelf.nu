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
  searchRows,
  visibleRows,
} from "./visible-rows";

/** `count` rows with ids "row-0", "row-1", ... in list order. */
const rowsOf = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }));

/** Sixty rows "Annex Store 001".."060", then "Store", then "Storeroom". */
const storeRows = () => [
  ...Array.from({ length: 60 }, (_, i) => ({
    id: `annex-${i + 1}`,
    name: `Annex Store ${String(i + 1).padStart(3, "0")}`,
  })),
  { id: "store", name: "Store" },
  { id: "storeroom", name: "Storeroom" },
];

test("returns every row, in order, for an empty search", () => {
  const items = storeRows();

  assert.equal(searchRows(items, ""), items);
});

test("keeps only the rows whose name contains the search, whatever the case", () => {
  const matches = searchRows(storeRows(), "ANNEX STORE 00");

  assert.deepEqual(
    matches.map((row) => row.id),
    [
      "annex-1",
      "annex-2",
      "annex-3",
      "annex-4",
      "annex-5",
      "annex-6",
      "annex-7",
      "annex-8",
      "annex-9",
    ]
  );
});

test("ranks the exact name first, then names that start with the search", () => {
  const matches = searchRows(storeRows(), "store");

  assert.equal(matches.length, 62);
  assert.deepEqual(
    matches.slice(0, 3).map((row) => row.id),
    ["store", "storeroom", "annex-1"]
  );
});

test("a row behind more matches than the cap is drawn when its name is typed", () => {
  // Unranked, "Store" is match 61 of 62 and the cap of 50 hides it.
  const { rows, hiddenCount } = visibleRows(searchRows(storeRows(), "Store"));

  assert.equal(rows[0].id, "store");
  assert.equal(rows.length, MAX_DROPDOWN_ROWS);
  assert.equal(hiddenCount, 62 - MAX_DROPDOWN_ROWS);
});

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
