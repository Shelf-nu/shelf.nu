/**
 * Tests for the method the app declares on booking check-in and check-out
 * requests, and for which path declares which value.
 *
 * These run under Node's test runner via tsx, so this file imports only pure
 * modules: the body helper, and the two screens' SOURCE text read from disk.
 * The screens themselves import React Native and cannot run here, so the
 * second half pins each call site's argument the way the contract tests in the
 * webapp pin a route file: by reading the file. A regression that drops the
 * method from a path, or swaps scanned for selected, fails here.
 *
 * @see ./booking-method.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { BOOKING_METHOD, withBookingMethod } from "./booking-method";

test("a declared method travels in the body", () => {
  assert.deepEqual(
    withBookingMethod({ bookingId: "b-1", assetIds: ["a-1"] }, "scanned"),
    { bookingId: "b-1", assetIds: ["a-1"], method: "scanned" }
  );
});

test("an undeclared method leaves the body exactly as before", () => {
  // The server records null for a request without the field; the field must
  // not be present as `undefined` either, which JSON would drop anyway, but
  // the shape is pinned so a serialiser change cannot start sending it.
  const body = withBookingMethod(
    { bookingId: "b-1", assetIds: ["a-1"] },
    undefined
  );
  assert.deepEqual(body, { bookingId: "b-1", assetIds: ["a-1"] });
  assert.equal("method" in body, false);
});

test("the two declared values are the two the server accepts", () => {
  // The server's CLIENT_DECLARED_BOOKING_METHODS; "quick" is deliberately not
  // declarable, the server knows which routes are the one-tap actions.
  assert.deepEqual(Object.values(BOOKING_METHOD).sort(), [
    "scanned",
    "selected",
  ]);
});

// ---------------------------------------------------------------------------
// Which path declares which value
// ---------------------------------------------------------------------------

const APP_DIR = path.resolve(__dirname, "../app/(tabs)");
const scannerSource = readFileSync(path.join(APP_DIR, "scanner.tsx"), "utf8");
const bookingScreenSource = readFileSync(
  path.join(APP_DIR, "bookings/[id].tsx"),
  "utf8"
);

/**
 * Every `api.<fn>(` call in `source`, as the text between its parentheses.
 * Call sites are multi-line, and a chained call breaks the line between `api`
 * and `.<fn>(`, so whitespace is allowed there; the argument list is matched up
 * to the first `);` after the call.
 */
function callArguments(source: string, fn: string): string[] {
  const pattern = new RegExp(`api\\s*\\.${fn}\\(([\\s\\S]*?)\\);`, "g");
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

test("the Scan tab declares every booking check-in and check-out as scanned", () => {
  for (const fn of [
    "partialCheckinBooking",
    "partialCheckoutBooking",
    "fulfilAndCheckoutBooking",
  ]) {
    const calls = callArguments(scannerSource, fn);
    assert.ok(calls.length > 0, `scanner.tsx calls api.${fn}`);
    for (const args of calls) {
      assert.match(
        args,
        /BOOKING_METHOD\.scanned/,
        `scanner.tsx api.${fn} declares BOOKING_METHOD.scanned`
      );
      assert.doesNotMatch(args, /BOOKING_METHOD\.selected/);
    }
  }
});

test("the booking screen's Select paths declare every check-in and check-out as selected", () => {
  for (const fn of ["partialCheckinBooking", "partialCheckoutBooking"]) {
    const calls = callArguments(bookingScreenSource, fn);
    assert.ok(calls.length > 0, `[id].tsx calls api.${fn}`);
    for (const args of calls) {
      assert.match(
        args,
        /BOOKING_METHOD\.selected/,
        `[id].tsx api.${fn} declares BOOKING_METHOD.selected`
      );
      assert.doesNotMatch(args, /BOOKING_METHOD\.scanned/);
    }
  }
});

test("the one-tap actions declare no method; the server knows they are quick", () => {
  for (const fn of ["checkinBooking", "checkoutBooking"]) {
    for (const args of callArguments(bookingScreenSource, fn)) {
      assert.doesNotMatch(args, /BOOKING_METHOD/);
    }
  }
});
