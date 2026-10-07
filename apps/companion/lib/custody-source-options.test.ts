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
  ALL_SOURCES,
  UNPLACED_SOURCE,
  UNRECORDED_SOURCE,
  assignSourceOptions,
  assignSourceRequestValue,
  checkoutSourceAnswers,
  checkoutSourceOptions,
  defaultAssignSourceOption,
  defaultCheckoutSource,
  describeHolderSources,
  questionsForCheckouts,
  releaseAsksForSource,
  releaseSourceOptions,
  releaseSourceQuantity,
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
  assert.equal(defaultAssignSourceOption([booth, studio, unplaced]), studio);
  // Ties go to the earlier location.
  const tie = option({ value: "tie", label: "Tie", placed: 10, left: 10 });
  assert.equal(defaultAssignSourceOption([tie, studio]), tie);
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
  assert.equal(defaultAssignSourceOption([empty, unplaced]), unplaced);
  assert.equal(defaultAssignSourceOption([empty]), empty);
  assert.equal(defaultAssignSourceOption([]), null);
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
    "3 unplaced · 4 location not recorded"
  );
  // One source reads like the web row: no count, the holder's total says it.
  assert.equal(
    describeHolderSources([
      { locationId: "b", unrecorded: false, name: "Studio", quantity: 3 },
    ]),
    "from Studio"
  );
});

const HOLDER_SOURCES = [
  { locationId: "a", unrecorded: false, name: "Camera Room", quantity: 2 },
  { locationId: null, unrecorded: false, name: null, quantity: 1 },
  { locationId: null, unrecorded: true, name: null, quantity: 4 },
];

test("release rows start with All sources, then map back to what the endpoint accepts", () => {
  const rows = releaseSourceOptions(HOLDER_SOURCES, "pcs");
  assert.deepEqual(
    rows.map((row) => [row.value, row.label, row.hint]),
    [
      [ALL_SOURCES, "All sources", "7 pcs"],
      ["a", "Camera Room", "2 pcs"],
      [UNPLACED_SOURCE, "Unplaced", "1 pcs"],
      [UNRECORDED_SOURCE, "Location not recorded", "4 pcs"],
    ]
  );
  // All sources sends no locationId: the server drains the whole hold.
  assert.equal(releaseSourceRequestValue(ALL_SOURCES), undefined);
  assert.equal(releaseSourceRequestValue("a"), "a");
  assert.equal(releaseSourceRequestValue(UNPLACED_SOURCE), null);
  assert.equal(releaseSourceRequestValue(UNRECORDED_SOURCE), "unrecorded");
});

test("a release asks for a source only with two or more", () => {
  assert.equal(releaseAsksForSource(undefined), false);
  assert.equal(releaseAsksForSource([HOLDER_SOURCES[0]]), false);
  assert.equal(releaseAsksForSource(HOLDER_SOURCES), true);
});

test("a release row caps at what it can give back", () => {
  assert.equal(releaseSourceQuantity(HOLDER_SOURCES, ALL_SOURCES), 7);
  assert.equal(releaseSourceQuantity(HOLDER_SOURCES, "a"), 2);
  assert.equal(releaseSourceQuantity(HOLDER_SOURCES, UNRECORDED_SOURCE), 4);
  // A row a refetch dropped caps at nothing, so the caller falls back.
  assert.equal(releaseSourceQuantity(HOLDER_SOURCES, "gone"), null);
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

test("questionsForCheckouts asks only about pools in the check-out", () => {
  const q1 = question();
  const q2 = question({ sliceId: "slice-2", assetId: "asset-2" });
  assert.deepEqual(
    questionsForCheckouts([q1, q2], [{ assetId: "asset-2", quantity: 10 }]),
    [q2]
  );
  assert.deepEqual(questionsForCheckouts(undefined, [{ assetId: "x" }]), []);
});

test("questionsForCheckouts carries the units leaving from the slice", () => {
  const q = question({ quantity: 10 });
  // Fewer than the slice holds: the sheet says 3, not 10.
  assert.equal(
    questionsForCheckouts([q], [{ assetId: "asset-1", quantity: 3 }])[0]
      .quantity,
    3
  );
  // More than the slice holds (the rest fills kit slices): capped at the slice.
  assert.equal(
    questionsForCheckouts([q], [{ assetId: "asset-1", quantity: 25 }])[0]
      .quantity,
    10
  );
  // A bare id sends everything still to go out.
  assert.equal(
    questionsForCheckouts([q], [{ assetId: "asset-1" }])[0].quantity,
    10
  );
});

test("questionsForCheckouts skips a slice the claim does not reach", () => {
  const q = question();
  // Tagged with a kit slice: the standalone slice is not going out.
  assert.deepEqual(
    questionsForCheckouts(
      [q],
      [{ assetId: "asset-1", bookingAssetId: "kit-slice", quantity: 4 }]
    ),
    []
  );
  // Tagged with the question's own slice: asked.
  assert.equal(
    questionsForCheckouts(
      [q],
      [{ assetId: "asset-1", bookingAssetId: "slice-1", quantity: 4 }]
    )[0].quantity,
    4
  );
  // Zero units leave: nothing to ask.
  assert.deepEqual(
    questionsForCheckouts([q], [{ assetId: "asset-1", quantity: 0 }]),
    []
  );
});
