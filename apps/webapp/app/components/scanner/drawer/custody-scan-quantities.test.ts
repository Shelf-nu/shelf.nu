/**
 * Pins the ceilings the custody scanners offer and the `quantities` field they
 * submit.
 *
 * The routes treat a missing entry as "not a quantity asset", so a row left
 * out of the payload is not handed over in smaller units. It is skipped
 * entirely, with the submission still reporting success. Nothing downstream
 * can tell the two apart, which is why the omission has to be caught here.
 *
 * @see {@link file://./custody-scan-quantities.ts}
 */

import { describe, expect, it } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

import {
  assignableUnits,
  buildQuantitiesPayload,
  buildSourceLocationsPayload,
  hasKitInheritedCustody,
  operatorHolderCount,
  releasableUnits,
  scannedSourceChoice,
  sourceCappedMax,
  shouldShowStateBadges,
} from "./custody-scan-quantities";

/** A scanned row, cut down to the fields these helpers read. */
function assetItem(
  asset: Partial<AssetFromQr> & { id: string }
): NonNullable<ScanListItems[string]> {
  return {
    type: "asset",
    data: { type: "QUANTITY_TRACKED", ...asset } as AssetFromQr,
  };
}

/**
 * An asset carrying just the custody rows the release ceiling reads. Each row
 * belongs to its own holder unless `teamMemberId` says otherwise.
 */
function assetWithCustody(
  custody: {
    quantity: number;
    kitCustodyId: string | null;
    teamMemberId?: string;
  }[]
): AssetFromQr {
  return {
    id: "asset-1",
    custody: custody.map((row, index) => ({
      teamMemberId: `tm-${index}`,
      ...row,
    })),
  } as unknown as AssetFromQr;
}

/** Stands in for a drawer's per-row ceiling; 10 units free unless stated. */
const tenFree = () => 10;

describe("assignableUnits", () => {
  it("prefers the server's custody pool", () => {
    expect(
      assignableUnits({
        pickerMeta: { maxAllowed: 46, assetQuantity: 76, unitOfMeasure: "pcs" },
        quantity: 76,
      } as AssetFromQr)
    ).toBe(46);
  });

  it("falls back to stock when the API answered without picker meta", () => {
    expect(assignableUnits({ quantity: 76 } as AssetFromQr)).toBe(76);
  });
});

describe("releasableUnits", () => {
  it("counts operator-assigned units", () => {
    expect(
      releasableUnits(assetWithCustody([{ quantity: 8, kitCustodyId: null }]))
    ).toBe(8);
  });

  it("ignores units inherited from a kit's custody", () => {
    // Those rows cascade off the kit's own custody, and both the route's
    // holder lookup and `releaseQuantity` scope themselves to the operator
    // axis, so offering them here promises a release that always errors.
    expect(
      releasableUnits(
        assetWithCustody([
          { quantity: 10, kitCustodyId: null },
          { quantity: 30, kitCustodyId: "kit-custody-1" },
        ])
      )
    ).toBe(10);
  });

  it("is zero for an asset held only through a kit, so no input renders", () => {
    expect(
      releasableUnits(
        assetWithCustody([{ quantity: 30, kitCustodyId: "kit-custody-1" }])
      )
    ).toBe(0);
  });
});

describe("operatorHolderCount", () => {
  it("counts the people holding operator-assigned units", () => {
    expect(
      operatorHolderCount(
        assetWithCustody([
          { quantity: 5, kitCustodyId: null },
          { quantity: 3, kitCustodyId: null },
        ])
      )
    ).toBe(2);
  });

  it("counts one person once when their units came from two locations", () => {
    // One operator row per source location: the same holder, not two.
    expect(
      operatorHolderCount(
        assetWithCustody([
          { quantity: 2, kitCustodyId: null, teamMemberId: "tm-ahmed" },
          { quantity: 1, kitCustodyId: null, teamMemberId: "tm-ahmed" },
        ])
      )
    ).toBe(1);
  });

  it("does not count a kit-inherited holder", () => {
    // A release scan names no custodian, so it is only unambiguous while one
    // person holds units. Counting the kit here would make a releasable asset
    // look shared and block it.
    expect(
      operatorHolderCount(
        assetWithCustody([
          { quantity: 5, kitCustodyId: null },
          { quantity: 30, kitCustodyId: "kit-custody-1" },
        ])
      )
    ).toBe(1);
  });

  it("is zero for an asset held only through a kit", () => {
    expect(
      operatorHolderCount(
        assetWithCustody([{ quantity: 30, kitCustodyId: "kit-custody-1" }])
      )
    ).toBe(0);
  });
});

describe("shouldShowStateBadges", () => {
  it("hides them on a quantity row that still has free units", () => {
    // 71 units with 26 in a kit reads "Part of kit", which an operator takes
    // to mean the asset cannot go, while 45 units are free to take.
    expect(
      shouldShowStateBadges({ type: "QUANTITY_TRACKED" } as AssetFromQr, 45)
    ).toBe(false);
  });

  it("shows them on a quantity row with nothing free", () => {
    expect(
      shouldShowStateBadges({ type: "QUANTITY_TRACKED" } as AssetFromQr, 0)
    ).toBe(true);
  });

  it("always shows them for an individual asset", () => {
    // For an INDIVIDUAL row the whole-asset status IS the answer, so gating it
    // would hide the reason the row cannot go.
    expect(
      shouldShowStateBadges({ type: "INDIVIDUAL" } as AssetFromQr, 0)
    ).toBe(true);
    expect(
      shouldShowStateBadges({ type: "INDIVIDUAL" } as AssetFromQr, 1)
    ).toBe(true);
  });
});

describe("hasKitInheritedCustody", () => {
  it("separates units held by the kit from nothing being held", () => {
    // The two look identical to a release (both leave zero operator units)
    // but only one should send the operator to the kit's QR.
    expect(
      hasKitInheritedCustody(
        assetWithCustody([{ quantity: 30, kitCustodyId: "kit-custody-1" }])
      )
    ).toBe(true);
    expect(hasKitInheritedCustody(assetWithCustody([]))).toBe(false);
  });

  it("is false when every row is operator-assigned", () => {
    expect(
      hasKitInheritedCustody(
        assetWithCustody([{ quantity: 8, kitCustodyId: null }])
      )
    ).toBe(false);
  });
});

describe("buildQuantitiesPayload", () => {
  it("emits a row the operator never touched, at the 1 its input displays", () => {
    // The whole point: `ScannedAssetQuantityInput` writes the atom only on
    // edit, so accepting the default leaves no entry, and reading the atom's
    // keys alone would drop the ordinary one-unit hand-over.
    const payload = buildQuantitiesPayload({
      items: { qr1: assetItem({ id: "asset-1" }) },
      assetIds: ["asset-1"],
      assetQuantities: {},
      unitsFor: tenFree,
    });

    expect(payload).toEqual({ "asset-1": 1 });
  });

  it("uses the number the operator typed when there is one", () => {
    const payload = buildQuantitiesPayload({
      items: { qr1: assetItem({ id: "asset-1" }) },
      assetIds: ["asset-1"],
      assetQuantities: { "asset-1": 6 },
      unitsFor: tenFree,
    });

    expect(payload).toEqual({ "asset-1": 6 });
  });

  it("leaves individual assets out, they are handed over whole", () => {
    const payload = buildQuantitiesPayload({
      items: { qr1: assetItem({ id: "asset-1", type: "INDIVIDUAL" }) },
      assetIds: ["asset-1"],
      assetQuantities: {},
      unitsFor: tenFree,
    });

    expect(payload).toEqual({});
  });

  it("leaves out a row with nothing free, which shows no input", () => {
    const payload = buildQuantitiesPayload({
      items: { qr1: assetItem({ id: "asset-1" }) },
      assetIds: ["asset-1"],
      assetQuantities: {},
      unitsFor: () => 0,
    });

    expect(payload).toEqual({});
  });

  it("drops a scanned row that is not in this submission", () => {
    // A removed row must not carry a stale number through.
    const payload = buildQuantitiesPayload({
      items: {
        qr1: assetItem({ id: "asset-1" }),
        qr2: assetItem({ id: "asset-removed" }),
      },
      assetIds: ["asset-1"],
      assetQuantities: { "asset-1": 2, "asset-removed": 9 },
      unitsFor: tenFree,
    });

    expect(payload).toEqual({ "asset-1": 2 });
  });

  it("ignores kit rows and rows that failed to resolve", () => {
    const payload = buildQuantitiesPayload({
      items: {
        qr1: { type: "kit", data: { id: "kit-1" } as never },
        qr2: { error: "This code doesn't exist" },
        qr3: undefined,
        qr4: assetItem({ id: "asset-1" }),
      },
      assetIds: ["asset-1", "kit-1"],
      assetQuantities: {},
      unitsFor: tenFree,
    });

    expect(payload).toEqual({ "asset-1": 1 });
  });
});

describe("scanned pools: where the units come from", () => {
  /** A pool placed at two locations, as the custody picker meta reports it. */
  const twoLocations = {
    maxAllowed: 4,
    assetQuantity: 4,
    unitOfMeasure: "pcs",
    sources: {
      multiSource: true,
      poolAvailable: 4,
      options: [
        {
          value: "loc-camera",
          locationId: "loc-camera",
          label: "Camera Room",
          placed: 2,
          inCustody: 1,
          left: 1,
        },
        {
          value: "loc-studio",
          locationId: "loc-studio",
          label: "Studio",
          placed: 2,
          inCustody: 0,
          left: 2,
        },
      ],
    },
  };

  const pool = (pickerMeta: object | null, id = "a1") =>
    ({ id, type: "QUANTITY_TRACKED", pickerMeta }) as unknown as AssetFromQr;

  it("pre-selects the location with the most units left", () => {
    expect(scannedSourceChoice(pool(twoLocations), {}).value).toBe(
      "loc-studio"
    );
  });

  it("caps the row at what the chosen location has left", () => {
    const choice = scannedSourceChoice(pool(twoLocations), {});
    // Studio (pre-selected) has 2 left of a pool-wide 4.
    expect(sourceCappedMax(4, choice)).toBe(2);
    expect(sourceCappedMax(4, { ...choice, value: "loc-camera" })).toBe(1);
    // The pool-wide ceiling still wins when it is lower.
    expect(sourceCappedMax(1, choice)).toBe(1);
    // A row with no picker keeps the pool-wide ceiling.
    expect(sourceCappedMax(4, { options: [], value: null })).toBe(4);
  });

  it("keeps the operator's pick while it is still an option", () => {
    expect(
      scannedSourceChoice(pool(twoLocations), { a1: "loc-camera" }).value
    ).toBe("loc-camera");
    expect(
      scannedSourceChoice(pool(twoLocations), { a1: "loc-gone" }).value
    ).toBe("loc-studio");
  });

  it("offers nothing for a pool at one location, or an individual asset", () => {
    const oneLocation = { ...twoLocations, sources: null };
    expect(scannedSourceChoice(pool(oneLocation), {})).toEqual({
      options: [],
      value: null,
    });
    expect(
      scannedSourceChoice(
        { id: "i1", type: "INDIVIDUAL", pickerMeta: null } as AssetFromQr,
        {}
      ).value
    ).toBeNull();
  });

  it("submits one source per pool that shows a picker, and nothing for the rest", () => {
    const items = {
      qr1: assetItem({ id: "a1", pickerMeta: twoLocations } as never),
      qr2: assetItem({
        id: "a2",
        pickerMeta: { ...twoLocations, sources: null },
      } as never),
      qr3: assetItem({
        id: "a3",
        pickerMeta: { ...twoLocations, maxAllowed: 0 },
      } as never),
    } as ScanListItems;

    expect(
      buildSourceLocationsPayload({
        items,
        assetIds: ["a1", "a2", "a3"],
        picked: { a1: "loc-camera" },
      })
    ).toEqual({ a1: "loc-camera" });
  });
});
