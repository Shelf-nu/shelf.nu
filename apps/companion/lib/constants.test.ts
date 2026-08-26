/**
 * Tests for the list-row status label.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The label refines IN_CUSTODY only: list payloads carry the custody side of
 * the unit math (`custodyList`), not the full per-status breakdown, so every
 * other status must fall through to the raw enum label untouched.
 *
 * @see ./constants.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { getListRowStatusLabel, formatStatus } from "./constants";

// ── getListRowStatusLabel ────────────────────────────────

test("partial custody: a QT asset with unheld units says Partial custody", () => {
  assert.equal(
    getListRowStatusLabel({
      status: "IN_CUSTODY",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      custodyList: [{ quantity: 3 }, { quantity: 4 }],
    }),
    "Partial custody"
  );
});

test("full custody: a QT asset with every unit held says In custody", () => {
  assert.equal(
    getListRowStatusLabel({
      status: "IN_CUSTODY",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      custodyList: [{ quantity: 10 }],
    }),
    "In custody"
  );
});

test("an INDIVIDUAL asset keeps the raw enum label", () => {
  assert.equal(
    getListRowStatusLabel({
      status: "IN_CUSTODY",
      type: "INDIVIDUAL",
      quantity: null,
      custodyList: [{ quantity: 1 }],
    }),
    formatStatus("IN_CUSTODY")
  );
});

test("statuses other than IN_CUSTODY are never refined", () => {
  assert.equal(
    getListRowStatusLabel({
      status: "CHECKED_OUT",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      custodyList: [{ quantity: 2 }],
    }),
    formatStatus("CHECKED_OUT")
  );
});

test("a pre-quantity server payload (no custodyList) falls back to the enum", () => {
  assert.equal(
    getListRowStatusLabel({ status: "IN_CUSTODY" }),
    formatStatus("IN_CUSTODY")
  );
});
