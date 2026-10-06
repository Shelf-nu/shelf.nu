/**
 * Tests for the phone's "From location" helpers.
 *
 * Runs under Node's test runner via tsx: no React Native, Expo or `@/`
 * imports here or in the module under test.
 *
 * @see ./custody-source-options.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UNPLACED_SOURCE,
  UNRECORDED_SOURCE,
  assignSourceOptions,
  assignSourceRequestValue,
  checkoutSourceAnswers,
  checkoutSourceOptions,
  defaultAssignSource,
  defaultCheckoutSource,
  describeHolderSources,
  questionsForAssets,
  releaseSourceOptions,
  releaseSourceRequestValue,
  sourceHint,
} from "./custody-source-options";
import type { CheckoutSourceQuestion, CustodySourceOption } from "./api/types";

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

test("sourceHint reads like the web dialog", () => {
  assert.equal(
    sourceHint({ placed: 10, inCustody: 0, onBooking: 0 }, "sandbags"),
    "10 sandbags"
  );
  assert.equal(
    sourceHint({ placed: 4, inCustody: 1, onBooking: 0 }, "sandbags"),
    "4 sandbags · 1 in custody"
  );
  assert.equal(
    sourceHint({ placed: 40, inCustody: 30, onBooking: 10 }, null),
    "40 · 30 in custody · 10 on a booking"
  );
});

test("defaultAssignSource picks the location with the most left, never Unplaced", () => {
  const studio = option({
    value: "studio",
    label: "Studio",
    placed: 10,
    left: 10,
  });
  const booth = option({ value: "booth", label: "Booth", placed: 4, left: 4 });
  const unplaced = option({
    value: UNPLACED_SOURCE,
    label: "Unplaced",
    placed: 20,
    left: 20,
  });
  assert.equal(defaultAssignSource([booth, studio, unplaced]), studio);
  // Ties go to the earlier location.
  const tie = option({ value: "tie", label: "Tie", placed: 10, left: 10 });
  assert.equal(defaultAssignSource([tie, studio]), tie);
});

test("defaultAssignSource falls back to Unplaced only when every location is empty", () => {
  const empty = option({
    value: "empty",
    label: "Empty",
    placed: 2,
    inCustody: 2,
    left: 0,
  });
  const unplaced = option({
    value: UNPLACED_SOURCE,
    label: "Unplaced",
    placed: 3,
    left: 3,
  });
  assert.equal(defaultAssignSource([empty, unplaced]), unplaced);
  assert.equal(defaultAssignSource([empty]), empty);
  assert.equal(defaultAssignSource([]), null);
});

test("assign rows carry the hint and Unplaced becomes null on the wire", () => {
  const rows = assignSourceOptions(
    [
      option({
        value: "studio",
        label: "Studio",
        placed: 10,
        left: 9,
        inCustody: 1,
      }),
      option({ value: UNPLACED_SOURCE, label: "Unplaced", placed: 2, left: 2 }),
    ],
    "pcs"
  );
  assert.deepEqual(rows, [
    { value: "studio", label: "Studio", hint: "10 pcs · 1 in custody" },
    { value: UNPLACED_SOURCE, label: "Unplaced", hint: "2 pcs" },
  ]);
  assert.equal(assignSourceRequestValue("studio"), "studio");
  assert.equal(assignSourceRequestValue(UNPLACED_SOURCE), null);
});

test("describeHolderSources names each source", () => {
  assert.equal(describeHolderSources(undefined), null);
  assert.equal(describeHolderSources([]), null);
  assert.equal(
    describeHolderSources([
      { locationId: "a", unrecorded: false, name: "Camera Room", quantity: 2 },
      { locationId: "b", unrecorded: false, name: "Studio", quantity: 1 },
    ]),
    "2 from Camera Room · 1 from Studio"
  );
  assert.equal(
    describeHolderSources([
      { locationId: null, unrecorded: false, name: null, quantity: 3 },
      { locationId: null, unrecorded: true, name: null, quantity: 4 },
    ]),
    "3 unplaced · 4 (location not recorded)"
  );
});

test("release rows map back to what the endpoint accepts", () => {
  const rows = releaseSourceOptions(
    [
      { locationId: "a", unrecorded: false, name: "Camera Room", quantity: 2 },
      { locationId: null, unrecorded: false, name: null, quantity: 1 },
      { locationId: null, unrecorded: true, name: null, quantity: 4 },
    ],
    "pcs"
  );
  assert.deepEqual(
    rows.map((row) => [row.value, row.label, row.hint]),
    [
      ["a", "Camera Room", "2 pcs"],
      [UNPLACED_SOURCE, "Unplaced", "1 pcs"],
      [UNRECORDED_SOURCE, "Location not recorded", "4 pcs"],
    ]
  );
  assert.equal(releaseSourceRequestValue("a"), "a");
  assert.equal(releaseSourceRequestValue(UNPLACED_SOURCE), null);
  assert.equal(releaseSourceRequestValue(UNRECORDED_SOURCE), "unrecorded");
});

function question(
  overrides: Partial<CheckoutSourceQuestion> = {}
): CheckoutSourceQuestion {
  return {
    sliceId: "slice-1",
    assetId: "asset-1",
    title: "Gloves",
    unitOfMeasure: "boxes",
    quantity: 10,
    placements: [
      {
        locationId: "cam",
        name: "Camera Room",
        placed: 60,
        inCustody: 0,
        onBooking: 0,
        left: 60,
      },
      {
        locationId: "stu",
        name: "Studio",
        placed: 40,
        inCustody: 0,
        onBooking: 10,
        left: 30,
      },
    ],
    unplaced: 0,
    defaultLocationId: "cam",
    ...overrides,
  };
}

test("check-out rows list each location, then Unplaced when there are unplaced units", () => {
  assert.deepEqual(
    checkoutSourceOptions(question()).map((row) => [row.value, row.hint]),
    [
      ["cam", "60 boxes"],
      ["stu", "40 boxes · 10 on a booking"],
    ]
  );
  assert.deepEqual(
    checkoutSourceOptions(question({ unplaced: 5 })).map((row) => row.value),
    ["cam", "stu", UNPLACED_SOURCE]
  );
});

test("check-out default follows the server; a null default means Unplaced", () => {
  assert.equal(defaultCheckoutSource(question()), "cam");
  // Every location empty, unplaced units left: the server says null = Unplaced.
  assert.equal(
    defaultCheckoutSource(question({ defaultLocationId: null, unplaced: 3 })),
    UNPLACED_SOURCE
  );
  assert.equal(
    defaultCheckoutSource(
      question({ defaultLocationId: null, placements: [], unplaced: 3 })
    ),
    UNPLACED_SOURCE
  );
  // Nothing anywhere (should not happen): the first location, not a crash.
  assert.equal(
    defaultCheckoutSource(question({ defaultLocationId: null })),
    "cam"
  );
});

test("check-out answers carry only the rows the operator changed, Unplaced as null", () => {
  assert.deepEqual(
    checkoutSourceAnswers(
      { "slice-1": "stu", "slice-2": UNPLACED_SOURCE, "slice-3": "cam" },
      ["slice-1", "slice-2"]
    ),
    { "slice-1": "stu", "slice-2": null }
  );
  assert.deepEqual(checkoutSourceAnswers({ "slice-1": "stu" }, []), {});
});

test("questionsForAssets keeps only the pools in the selection", () => {
  const q1 = question();
  const q2 = question({ sliceId: "slice-2", assetId: "asset-2" });
  assert.deepEqual(questionsForAssets([q1, q2], ["asset-2"]), [q2]);
  assert.deepEqual(questionsForAssets(undefined, ["asset-2"]), []);
});
