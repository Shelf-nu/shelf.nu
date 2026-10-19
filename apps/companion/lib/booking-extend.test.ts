/**
 * Tests for the booking extension rules.
 *
 * @see {@link file://./booking-extend.ts}
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExtendPayload,
  canOfferExtend,
  extendFloor,
  newEndError,
  shiftEnd,
} from "./booking-extend";

test("canOfferExtend offers the action only when the server sends true", () => {
  assert.equal(canOfferExtend({ canExtend: true }), true);
  assert.equal(canOfferExtend({ canExtend: false }), false);
  // A server that predates the flag has no extend endpoint either.
  assert.equal(canOfferExtend({}), false);
});

test("newEndError refuses an end at or before the current end", () => {
  const currentEnd = new Date("2026-06-01T10:00:00Z");
  const now = new Date("2026-06-01T08:00:00Z");
  const message = "The new end must be after the current end.";

  assert.equal(
    newEndError(new Date("2026-06-01T10:00:00Z"), currentEnd, now),
    message
  );
  assert.equal(
    newEndError(new Date("2026-06-01T09:59:00Z"), currentEnd, now),
    message
  );
  assert.equal(
    newEndError(new Date("2026-06-01T10:01:00Z"), currentEnd, now),
    null
  );
});

test("newEndError refuses a later end that is still in the past", () => {
  // An OVERDUE booking: its end passed yesterday, so an hour past it is
  // still long gone.
  const currentEnd = new Date("2026-06-01T10:00:00Z");
  const now = new Date("2026-06-02T09:00:00Z");

  assert.equal(
    newEndError(new Date("2026-06-01T11:00:00Z"), currentEnd, now),
    "The new end must be in the future."
  );
  assert.equal(
    newEndError(new Date("2026-06-02T10:00:00Z"), currentEnd, now),
    null
  );
});

test("extendFloor opens on the current end, or on now once it has passed", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const later = new Date("2026-06-01T15:00:00Z");
  const earlier = new Date("2026-05-31T10:00:00Z");

  assert.deepEqual(extendFloor(later, now), later);
  assert.deepEqual(extendFloor(earlier, now), now);
});

test("buildExtendPayload sends the end as a wall clock in the declared zone", () => {
  // 06:30 UTC is 14:30 in Kuala Lumpur (UTC+8), the shape the extend
  // endpoint decodes in the zone sent beside it.
  assert.deepEqual(
    buildExtendPayload(
      "booking-1",
      new Date("2030-06-01T06:30:00.000Z"),
      "Asia/Kuala_Lumpur"
    ),
    {
      bookingId: "booking-1",
      endDate: "2030-06-01T14:30",
      timeZone: "Asia/Kuala_Lumpur",
    }
  );
});

test("shiftEnd adds elapsed hours for the hour presets", () => {
  // The night Amsterdam's clocks go forward: 00:30 UTC is 01:30 CET, and an
  // hour later is 03:30 CEST. Elapsed time, not the wall clock, moves.
  const base = new Date("2026-03-29T00:30:00Z");

  assert.deepEqual(
    shiftEnd(base, "hour", "Europe/Amsterdam"),
    new Date("2026-03-29T01:30:00Z")
  );
  assert.deepEqual(
    shiftEnd(base, "fourHours", "Europe/Amsterdam"),
    new Date("2026-03-29T04:30:00Z")
  );
});

test("shiftEnd moves a day by the calendar, keeping the wall clock across DST", () => {
  // 13:00 CET on Saturday 28 March; the next day 13:00 is CEST, which is 11:00
  // UTC, 23 hours later.
  assert.deepEqual(
    shiftEnd(new Date("2026-03-28T12:00:00Z"), "day", "Europe/Amsterdam"),
    new Date("2026-03-29T11:00:00Z")
  );
  // Without a DST change a day is 24 hours.
  assert.deepEqual(
    shiftEnd(new Date("2026-06-01T12:00:00Z"), "day", "Europe/Amsterdam"),
    new Date("2026-06-02T12:00:00Z")
  );
});
