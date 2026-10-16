/**
 * Tests for the custody source vocabulary both apps read: the picker values,
 * the assign default and the source wording.
 *
 * @see ./custody-source.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CustodySourceOption } from "./custody-source";
import {
  custodySourceKey,
  defaultAssignSourceOption,
  defaultSourceOption,
  describeCustodySourceParts,
  isUnplacedSource,
  sourceCommitmentParts,
  sourceEntryLabel,
  UNPLACED_SOURCE,
  UNRECORDED_SOURCE,
} from "./custody-source";

function option(
  overrides: Partial<CustodySourceOption> & { value: string }
): CustodySourceOption {
  return {
    locationId: overrides.value === UNPLACED_SOURCE ? null : overrides.value,
    label: overrides.value,
    placed: 0,
    inCustody: 0,
    onBooking: 0,
    left: 0,
    ...overrides,
  };
}

test("isUnplacedSource: null, empty and the word; undefined is not", () => {
  assert.equal(isUnplacedSource(null), true);
  assert.equal(isUnplacedSource(""), true);
  assert.equal(isUnplacedSource(UNPLACED_SOURCE), true);
  assert.equal(isUnplacedSource(undefined), false);
  assert.equal(isUnplacedSource("loc-1"), false);
});

test("custodySourceKey names a location, the unplaced units or an unrecorded source", () => {
  assert.equal(
    custodySourceKey({ locationId: "a", sourceUnknown: false }),
    "a"
  );
  assert.equal(
    custodySourceKey({ locationId: null, sourceUnknown: false }),
    UNPLACED_SOURCE
  );
  assert.equal(
    custodySourceKey({ locationId: null, sourceUnknown: true }),
    UNRECORDED_SOURCE
  );
});

test("defaultSourceOption: the location with the most left, never Unplaced", () => {
  const a = option({ value: "a", left: 4 });
  const b = option({ value: "b", left: 9 });
  const unplaced = option({ value: UNPLACED_SOURCE, left: 50 });
  assert.equal(defaultSourceOption([a, b, unplaced]), b);
  // Ties go to the earlier location.
  assert.equal(defaultSourceOption([b, option({ value: "c", left: 9 })]), b);
  assert.equal(defaultSourceOption([unplaced]), null);
});

test("defaultAssignSourceOption: Unplaced only when every location is empty", () => {
  const empty = option({ value: "a", left: 0 });
  const unplaced = option({ value: UNPLACED_SOURCE, left: 3 });
  assert.equal(defaultAssignSourceOption([empty, unplaced]), unplaced);
  assert.equal(defaultAssignSourceOption([empty]), empty);
  assert.equal(
    defaultAssignSourceOption([empty, option({ value: UNPLACED_SOURCE })]),
    empty
  );
  assert.equal(defaultAssignSourceOption([]), null);
});

test("sourceCommitmentParts lists only what is committed", () => {
  assert.deepEqual(sourceCommitmentParts({ inCustody: 0, onBooking: 0 }), []);
  assert.deepEqual(sourceCommitmentParts({ inCustody: 1, onBooking: 10 }), [
    "1 in custody",
    "10 on a booking",
  ]);
});

test("sourceEntryLabel heads a picker row or release line", () => {
  assert.equal(
    sourceEntryLabel({ locationId: "a", unrecorded: false, name: "Studio" }),
    "Studio"
  );
  assert.equal(
    sourceEntryLabel({ locationId: null, unrecorded: false, name: null }),
    "Unplaced"
  );
  assert.equal(
    sourceEntryLabel({ locationId: null, unrecorded: true, name: null }),
    "Location not recorded"
  );
});

test("describeCustodySourceParts: no count for one source, counts for several", () => {
  assert.deepEqual(
    describeCustodySourceParts([
      { locationId: "a", unrecorded: false, name: "Studio", quantity: 3 },
    ]),
    [{ key: "a", text: "from Studio", muted: false }]
  );
  assert.deepEqual(
    describeCustodySourceParts([
      { locationId: "a", unrecorded: false, name: "Camera Room", quantity: 2 },
      { locationId: null, unrecorded: false, name: null, quantity: 1 },
      { locationId: null, unrecorded: true, name: null, quantity: 4 },
    ]),
    [
      { key: "a", text: "2 from Camera Room", muted: false },
      { key: UNPLACED_SOURCE, text: "1 unplaced", muted: false },
      { key: UNRECORDED_SOURCE, text: "4 location not recorded", muted: true },
    ]
  );
  assert.deepEqual(describeCustodySourceParts([]), []);
});
