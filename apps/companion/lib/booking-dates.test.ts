/**
 * Tests for the shared booking date rules.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The zone cases pass ONE pair of instants through SEVERAL zones and expect
 * DIFFERENT results, so an implementation that ignores `timeZone` cannot pass.
 *
 * @see ./booking-dates.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { keepEndAfterStart } from "./booking-dates";

// ── keepEndAfterStart ────────────────────────────────────

test("keepEndAfterStart leaves an end that is already later alone", () => {
  const start = new Date("2026-08-20T09:00:00Z");
  const end = new Date("2026-08-20T17:00:00Z");

  assert.equal(keepEndAfterStart(end, start, "UTC"), end);
});

test("keepEndAfterStart leaves a null end null rather than inventing one", () => {
  assert.equal(
    keepEndAfterStart(null, new Date("2026-08-20T09:00:00Z"), "UTC"),
    null
  );
});

test("keepEndAfterStart moves an end that equals the start", () => {
  const start = new Date("2026-08-20T09:00:00Z");

  const corrected = keepEndAfterStart(new Date(start), start, "UTC");

  assert.ok(corrected);
  assert.equal(corrected.toISOString(), "2026-08-21T09:00:00.000Z");
});

test("keepEndAfterStart moves an end that is before the start", () => {
  const start = new Date("2026-08-20T09:00:00Z");
  const end = new Date("2026-08-19T17:00:00Z");

  const corrected = keepEndAfterStart(end, start, "UTC");

  assert.ok(corrected);
  assert.equal(corrected.toISOString(), "2026-08-21T09:00:00.000Z");
});

test("keepEndAfterStart holds the wall clock across a DST boundary", () => {
  // 2026-03-08 is the spring forward in Los Angeles, so that calendar day is 23
  // hours. Adding a fixed 24h would land at 11:00 local instead of 10:00.
  const start = new Date("2026-03-07T18:00:00Z"); // 10:00 in Los Angeles
  const end = new Date("2026-03-07T17:00:00Z"); // 09:00, before the start

  const corrected = keepEndAfterStart(end, start, "America/Los_Angeles");

  assert.ok(corrected);
  assert.equal(corrected.toISOString(), "2026-03-08T17:00:00.000Z");
  assert.equal(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(corrected),
    "10:00"
  );
});

test("keepEndAfterStart resolves the day in the given zone, not a fixed 24h", () => {
  // The SAME instants through two zones must give DIFFERENT answers, or the
  // zone is not doing any work. These straddle the Los Angeles spring forward,
  // where the calendar day is 23 hours; UTC has no transition, so its day is a
  // flat 24 and the two land an hour apart.
  const start = new Date("2026-03-07T18:00:00Z");
  const end = new Date("2026-03-07T17:00:00Z");

  const inLosAngeles = keepEndAfterStart(end, start, "America/Los_Angeles");
  const inUtc = keepEndAfterStart(end, start, "UTC");

  assert.ok(inLosAngeles);
  assert.ok(inUtc);
  assert.equal(inLosAngeles.toISOString(), "2026-03-08T17:00:00.000Z");
  assert.equal(inUtc.toISOString(), "2026-03-08T18:00:00.000Z");
});
