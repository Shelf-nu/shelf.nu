/**
 * Tests for the post-duplicate message.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./booking-duplicate-note.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { duplicateLeftOutNote } from "./booking-duplicate-note";

test("a complete copy has nothing to say", () => {
  assert.equal(duplicateLeftOutNote({}), null);
  assert.equal(
    duplicateLeftOutNote({
      droppedArchivedCount: 0,
      reducedModelReservations: [],
    }),
    null
  );
});

test("names archived assets and short reservations together", () => {
  // The shape `POST /api/mobile/bookings/duplicate` returns.
  assert.equal(
    duplicateLeftOutNote({
      droppedArchivedCount: 2,
      reducedModelReservations: [
        {
          assetModelId: "model-camera",
          assetModelName: "Camera",
          requested: 4,
          reserved: 1,
        },
      ],
    }),
    "2 archived assets were left out. Only 1 of 4 × Camera could be reserved for the new dates."
  );
});

test("says a reservation that failed should be retried, not that the dates were short", () => {
  assert.equal(
    duplicateLeftOutNote({
      reducedModelReservations: [
        {
          assetModelId: "model-camera",
          assetModelName: "Camera",
          requested: 4,
          reserved: 0,
          failed: true,
        },
      ],
    }),
    "Could not reserve 4 × Camera. Try again from the booking."
  );
});
