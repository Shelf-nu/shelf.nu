/**
 * Tests for the booking screen's pool source helpers.
 *
 * Runs under Node's test runner via tsx: no React Native, Expo or `@/`
 * imports here or in the module under test.
 *
 * @see ./booking-sources.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { BookingSourcePart } from "@shelf/quantity-control";

import type { BookingAssetSlice } from "./api/types";
import {
  AUTO_SOURCES,
  adjustSheetSources,
  describeSourcesForA11y,
  sliceSourceLine,
  sourceLineText,
  standaloneSlice,
} from "./booking-sources";

/** A part as the server sends it in `slices[].sources`. */
function part(
  label: string,
  planned: number,
  kind: BookingSourcePart["kind"] = "LOCATION",
  short = false
): BookingSourcePart {
  return {
    key: `${kind}:${label}`,
    kind,
    locationId: kind === "LOCATION" ? label : null,
    label,
    planned,
    out: 0,
    short,
  };
}

function slice(overrides: Partial<BookingAssetSlice> = {}): BookingAssetSlice {
  return {
    bookingAssetId: "ba-1",
    quantity: 15,
    assetKitId: null,
    kit: null,
    sourceLocation: null,
    sources: [],
    sourceAllocation: "AUTO",
    ...overrides,
  };
}

test("a split reads as the summary, one source by its name", () => {
  assert.deepEqual(
    sliceSourceLine(
      slice({
        sources: [part("Demo Warehouse", 8), part("Unplaced", 7, "UNPLACED")],
      })
    ),
    { text: "Demo Warehouse 8 · Unplaced 7", warnings: [], placed: true }
  );
  assert.deepEqual(
    sliceSourceLine(slice({ sources: [part("Demo Warehouse", 15)] })),
    { text: "Demo Warehouse", warnings: [], placed: true }
  );
});

test("a short source is named; no sources, or an older server, prints nothing", () => {
  assert.deepEqual(
    sliceSourceLine(
      slice({
        sources: [
          part("Demo Warehouse", 8, "LOCATION", true),
          part("Needs a location", 7, "UNASSIGNED", true),
        ],
      })
    )?.warnings,
    ["Short at Demo Warehouse"]
  );
  assert.equal(sliceSourceLine(slice()), null);
  assert.equal(sliceSourceLine({}), null);
});

test("the booked-quantity sheet changes the standalone slice", () => {
  const kitSlice = slice({
    bookingAssetId: "ba-kit",
    assetKitId: "ak-1",
    kit: { id: "kit-1", name: "Event kit" },
  });
  const own = slice({ bookingAssetId: "ba-own" });
  assert.equal(standaloneSlice({ slices: [kitSlice, own] }), own);
  assert.equal(standaloneSlice({ slices: [kitSlice] }), null);
  assert.equal(standaloneSlice({}), null);
});

test("the sheet offers Auto only for a split set by hand", () => {
  const sources = [part("Demo Warehouse", 8), part("Unplaced", 7, "UNPLACED")];
  assert.deepEqual(
    adjustSheetSources(slice({ sources, sourceAllocation: "MANUAL" })),
    {
      line: {
        text: "Demo Warehouse 8 · Unplaced 7",
        warnings: [],
        placed: true,
      },
      canUseAuto: true,
    }
  );
  assert.equal(
    adjustSheetSources(slice({ sources, sourceAllocation: "AUTO" })).canUseAuto,
    false
  );
  assert.deepEqual(adjustSheetSources(null), {
    line: null,
    canUseAuto: false,
  });
});

test("Auto is posted in the shape the server reads", () => {
  assert.deepEqual(AUTO_SOURCES, { mode: "AUTO" });
});

test("the row's screen-reader label names the sources and a short one", () => {
  assert.equal(
    describeSourcesForA11y({
      type: "QUANTITY_TRACKED",
      slices: [
        slice({
          sources: [
            part("Demo Warehouse", 8, "LOCATION", true),
            part("Unplaced", 7, "UNPLACED"),
          ],
        }),
      ],
    }),
    ", units from Demo Warehouse 8 · Unplaced 7, Short at Demo Warehouse"
  );
  assert.equal(
    describeSourcesForA11y({ type: "QUANTITY_TRACKED", slices: [slice()] }),
    ""
  );
});

test("a slice with planned sources is described once, never also by where it left from", () => {
  assert.equal(
    describeSourcesForA11y({
      type: "QUANTITY_TRACKED",
      slices: [
        slice({
          sources: [part("Demo Warehouse", 15)],
          sourceLocation: { id: "loc-old", name: "Old Shelf" },
        }),
      ],
    }),
    ", units from Demo Warehouse"
  );
});

test("a slice without planned sources is described by where its units left from", () => {
  assert.equal(
    describeSourcesForA11y({
      type: "QUANTITY_TRACKED",
      slices: [
        slice({ sourceLocation: { id: "cam", name: "Camera Room" } }),
        slice({
          bookingAssetId: "ba-kit",
          assetKitId: "ak-1",
          kit: { id: "kit-1", name: "Event kit" },
          sourceLocation: { id: "stu", name: "Studio" },
        }),
      ],
    }),
    ", booked units from Camera Room"
  );
  assert.equal(
    describeSourcesForA11y({
      type: "INDIVIDUAL",
      slices: [slice({ sourceLocation: { id: "cam", name: "Camera Room" } })],
    }),
    ""
  );
});

test("a line with a place reads From; a lone Needs a location or Unknown reads as its label", () => {
  const placed = sliceSourceLine(
    slice({
      sources: [
        part("Demo Warehouse", 8),
        part("Needs a location", 7, "UNASSIGNED", true),
      ],
    })
  );
  assert.ok(placed);
  assert.equal(
    sourceLineText(placed),
    "From Demo Warehouse 8 · Needs a location 7"
  );

  const unassigned = sliceSourceLine(
    slice({ sources: [part("Needs a location", 15, "UNASSIGNED", true)] })
  );
  assert.deepEqual(unassigned, {
    text: "Needs a location",
    warnings: [],
    placed: false,
  });
  assert.equal(sourceLineText(unassigned), "Needs a location");

  const unknown = sliceSourceLine(
    slice({ sources: [part("Unknown", 15, "UNKNOWN")] })
  );
  assert.deepEqual(unknown, { text: "Unknown", warnings: [], placed: false });
  assert.equal(sourceLineText(unknown), "Unknown");

  const unplaced = sliceSourceLine(
    slice({ sources: [part("Unplaced", 15, "UNPLACED")] })
  );
  assert.ok(unplaced);
  assert.equal(sourceLineText(unplaced), "From Unplaced");
});

test("the screen-reader label says From only when a source is a place", () => {
  assert.equal(
    describeSourcesForA11y({
      type: "QUANTITY_TRACKED",
      slices: [
        slice({ sources: [part("Needs a location", 15, "UNASSIGNED", true)] }),
      ],
    }),
    ", Needs a location"
  );
  assert.equal(
    describeSourcesForA11y({
      type: "QUANTITY_TRACKED",
      slices: [slice({ sources: [part("Unknown", 15, "UNKNOWN", true)] })],
    }),
    ", Unknown, Short at Unknown"
  );
});
