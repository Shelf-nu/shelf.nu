/**
 * Tests for collecting every page of a paginated list.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./fetch-all-pages.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_PAGES_HARD_STOP,
  ALL_PAGES_PAGE_SIZE,
  fetchAllPages,
} from "./fetch-all-pages";

type Loc = { id: string };

/** A fake list endpoint holding `total` rows, served `perPage` at a time. */
function fakeEndpoint(total: number) {
  const calls: { page: number; perPage: number }[] = [];
  const fetchPage = async (page: number, perPage: number) => {
    calls.push({ page, perPage });
    const start = (page - 1) * perPage;
    const locations: Loc[] = Array.from(
      { length: Math.max(0, Math.min(perPage, total - start)) },
      (_, i) => ({ id: `loc-${start + i + 1}` })
    );
    return {
      data: { locations, totalPages: Math.max(1, Math.ceil(total / perPage)) },
      error: null,
    };
  };
  return { fetchPage, calls };
}

test("returns rows past the first page", async () => {
  const { fetchPage, calls } = fakeEndpoint(260);

  const { rows, error } = await fetchAllPages(fetchPage, (d) => d.locations);

  assert.equal(error, null);
  assert.equal(rows.length, 260);
  assert.equal(rows[259].id, "loc-260");
  assert.deepEqual(
    calls.map((c) => c.page),
    [1, 2, 3]
  );
  assert.ok(calls.every((c) => c.perPage === ALL_PAGES_PAGE_SIZE));
});

test("makes one request when everything fits on a page", async () => {
  const { fetchPage, calls } = fakeEndpoint(12);

  const { rows } = await fetchAllPages(fetchPage, (d) => d.locations);

  assert.equal(rows.length, 12);
  assert.equal(calls.length, 1);
});

test("stops at the hard stop", async () => {
  const { fetchPage, calls } = fakeEndpoint(
    (ALL_PAGES_HARD_STOP + 5) * ALL_PAGES_PAGE_SIZE
  );

  const { truncated, error } = await fetchAllPages(
    fetchPage,
    (d) => d.locations
  );

  assert.equal(calls.length, ALL_PAGES_HARD_STOP);
  assert.equal(error, null);
  // The caller is told the list is not complete.
  assert.equal(truncated, true);
});

test("is not truncated when the last page is reached", async () => {
  const { fetchPage } = fakeEndpoint(260);

  const { truncated } = await fetchAllPages(fetchPage, (d) => d.locations);

  assert.equal(truncated, false);
});

test("treats a page with neither data nor an error as a failure", async () => {
  const fetchPage = async (page: number) =>
    page === 1
      ? { data: { locations: [{ id: "a" }], totalPages: 2 }, error: null }
      : { data: null, error: null };

  const { rows, error } = await fetchAllPages<{ locations: Loc[] }, Loc>(
    fetchPage,
    (d) => d.locations
  );

  assert.equal(error, "Failed to load");
  assert.deepEqual(rows, [{ id: "a" }]);
});

test("returns the error and the rows loaded so far when a page fails", async () => {
  const fetchPage = async (page: number) =>
    page === 1
      ? { data: { locations: [{ id: "a" }], totalPages: 2 }, error: null }
      : { error: "Network error" };

  const { rows, error } = await fetchAllPages<{ locations: Loc[] }, Loc>(
    fetchPage,
    (d) => d.locations
  );

  assert.equal(error, "Network error");
  assert.deepEqual(rows, [{ id: "a" }]);
});
