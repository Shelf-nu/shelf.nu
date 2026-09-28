/**
 * Every blocker the two custody drawers can raise, one case each.
 *
 * A missing blocker is not a missing warning. A scanned row the drawer cannot
 * act on is submitted anyway, skipped by the service, and reported as a
 * success, so the operator is told the hand-over happened when nothing moved.
 * Three of those shipped from these two drawers, all found by hand in a
 * browser, because the list was derived inside a component nothing mounts.
 *
 * The contract these pin: for each blocker id, a row in that state raises it,
 * and a healthy row does not. `EXPECTED_*_IDS` pins the set itself, so adding
 * a blocker without a case here fails rather than passing silently.
 *
 * @see {@link file://./custody-blockers.tsx}
 */

import { describe, expect, it, vi } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

import {
  buildAssignCustodyBlockers,
  buildReleaseCustodyBlockers,
  type CustodyBlockers,
} from "./custody-blockers";

/** Every blocker the assign drawer declares, in order. */
const EXPECTED_ASSIGN_IDS = [
  "qty-nothing-free",
  "assets-already-in-custody",
  "assets-checked-out",
  "assets-part-of-kit",
  "kits-in-custody",
  "kits-with-assets-in-custody",
  "kits-checked-out",
  "invalid-codes",
];

/** Every blocker the release drawer declares, in order. */
const EXPECTED_RELEASE_IDS = [
  "qty-held-via-kit",
  "qty-nothing-held",
  "qty-several-holders",
  "assets-not-in-custody",
  "assets-part-of-kit",
  "kits-not-in-custody",
  "invalid-codes",
];

/** A scanned asset row, cut down to the fields the blockers read. */
function assetItem(asset: Partial<AssetFromQr> & { id: string }) {
  return {
    type: "asset" as const,
    data: {
      type: "INDIVIDUAL",
      status: "AVAILABLE",
      assetKits: [],
      custody: [],
      ...asset,
    } as unknown as AssetFromQr,
  };
}

/** A quantity-tracked asset row. `pickerMeta` drives the assign ceiling. */
function qtyItem(
  id: string,
  {
    available,
    custody = [],
    quantity = 100,
  }: {
    available?: number;
    custody?: { quantity: number; kitCustodyId: string | null }[];
    quantity?: number;
  }
) {
  return assetItem({
    id,
    type: "QUANTITY_TRACKED",
    quantity,
    custody,
    ...(available === undefined
      ? {}
      : {
          pickerMeta: {
            maxAllowed: available,
            assetQuantity: quantity,
            unitOfMeasure: null,
          },
        }),
  } as Partial<AssetFromQr> & { id: string });
}

/** A scanned kit row. */
function kitItem(
  id: string,
  {
    status = "AVAILABLE",
    memberStatuses = [],
  }: { status?: string; memberStatuses?: string[] } = {}
) {
  return {
    type: "kit" as const,
    data: {
      id,
      status,
      assetKits: memberStatuses.map((s) => ({ asset: { status: s } })),
    } as never,
  };
}

/** Builds with spies so resolve wiring can be asserted too. */
function build(
  which: "assign" | "release",
  items: ScanListItems
): CustodyBlockers & {
  removeAssetsFromList: ReturnType<typeof vi.fn>;
  removeItemsFromList: ReturnType<typeof vi.fn>;
} {
  const removeAssetsFromList = vi.fn();
  const removeItemsFromList = vi.fn();
  const builder =
    which === "assign"
      ? buildAssignCustodyBlockers
      : buildReleaseCustodyBlockers;
  return {
    ...builder({ items, removeAssetsFromList, removeItemsFromList }),
    removeAssetsFromList,
    removeItemsFromList,
  };
}

/** Ids of the blockers currently firing. */
function activeIds(built: CustodyBlockers): string[] {
  return built.blockerConfigs.filter((b) => b.condition).map((b) => b.id ?? "");
}

describe("buildAssignCustodyBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    // Adding a blocker without a case below fails here rather than shipping
    // untested, which is how three missing blockers reached the browser.
    const built = build("assign", {});
    expect(built.blockerConfigs.map((b) => b.id)).toEqual(EXPECTED_ASSIGN_IDS);
  });

  it("raises nothing for a healthy scan", () => {
    const built = build("assign", {
      qr1: assetItem({ id: "a1" }),
      qr2: qtyItem("a2", { available: 40 }),
      qr3: kitItem("k1"),
    });
    expect(activeIds(built)).toEqual([]);
  });

  it("qty-nothing-free: a quantity row with no units left", () => {
    const built = build("assign", { qr1: qtyItem("a1", { available: 0 }) });
    expect(activeIds(built)).toEqual(["qty-nothing-free"]);
    expect(built.blockerConfigs[0].count).toBe(1);
  });

  it("qty-nothing-free: does not fire while units remain", () => {
    const built = build("assign", { qr1: qtyItem("a1", { available: 1 }) });
    expect(activeIds(built)).toEqual([]);
  });

  it("assets-already-in-custody: an individual asset held by someone", () => {
    const built = build("assign", {
      qr1: assetItem({ id: "a1", status: "IN_CUSTODY" }),
    });
    expect(activeIds(built)).toEqual(["assets-already-in-custody"]);
  });

  it("assets-checked-out: an individual asset out on a booking", () => {
    const built = build("assign", {
      qr1: assetItem({ id: "a1", status: "CHECKED_OUT" }),
    });
    expect(activeIds(built)).toEqual(["assets-checked-out"]);
  });

  it("status blockers never judge a quantity row", () => {
    // `Asset.status` is one flag for the whole row, so a quantity pool reads
    // IN_CUSTODY while a single unit is held and the rest is free stock.
    const built = build("assign", {
      qr1: qtyItem("a1", { available: 40 }),
    });
    const qty = { ...built.blockerConfigs[0] };
    expect(qty.id).toBe("qty-nothing-free");
    expect(activeIds(built)).toEqual([]);
  });

  it("assets-part-of-kit: an individual member of a kit", () => {
    const built = build("assign", {
      qr1: assetItem({ id: "a1", assetKits: [{ kitId: "k1" }] as never }),
    });
    expect(activeIds(built)).toEqual(["assets-part-of-kit"]);
  });

  it("assets-part-of-kit: a quantity member is allowed, its free pool is usable", () => {
    const built = build("assign", {
      qr1: qtyItem("a1", { available: 40 }),
    });
    expect(activeIds(built)).not.toContain("assets-part-of-kit");
  });

  it("kits-in-custody, kits-with-assets-in-custody, kits-checked-out", () => {
    expect(
      activeIds(
        build("assign", { qr1: kitItem("k1", { status: "IN_CUSTODY" }) })
      )
    ).toEqual(["kits-in-custody"]);

    expect(
      activeIds(
        build("assign", {
          qr1: kitItem("k1", { memberStatuses: ["IN_CUSTODY"] }),
        })
      )
    ).toEqual(["kits-with-assets-in-custody"]);

    expect(
      activeIds(
        build("assign", { qr1: kitItem("k1", { status: "CHECKED_OUT" }) })
      )
    ).toEqual(["kits-checked-out"]);
  });

  it("invalid-codes: a code that resolved to nothing", () => {
    const built = build("assign", { qr1: { error: "No such code" } });
    expect(activeIds(built)).toEqual(["invalid-codes"]);
  });

  it("resolve-all drops every blocked row, assets by id and kits by code", () => {
    const built = build("assign", {
      qr1: qtyItem("a1", { available: 0 }),
      qr2: assetItem({ id: "a2", status: "IN_CUSTODY" }),
      qrKit: kitItem("k1", { status: "CHECKED_OUT" }),
      qrBad: { error: "No such code" },
    });

    built.onResolveAll();

    expect(built.removeAssetsFromList).toHaveBeenCalledWith(
      expect.arrayContaining(["a1", "a2"])
    );
    // Kits and unresolved codes are keyed by the CODE, not the kit id.
    expect(built.removeItemsFromList).toHaveBeenCalledWith(
      expect.arrayContaining(["qrKit", "qrBad"])
    );
  });
});

describe("buildReleaseCustodyBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    const built = build("release", {});
    expect(built.blockerConfigs.map((b) => b.id)).toEqual(EXPECTED_RELEASE_IDS);
  });

  it("raises nothing for a healthy scan", () => {
    const built = build("release", {
      qr1: assetItem({ id: "a1", status: "IN_CUSTODY" }),
      qr2: qtyItem("a2", { custody: [{ quantity: 5, kitCustodyId: null }] }),
      qr3: kitItem("k1", { status: "IN_CUSTODY" }),
    });
    expect(activeIds(built)).toEqual([]);
  });

  it("qty-held-via-kit: every unit came from the kit's custody", () => {
    const built = build("release", {
      qr1: qtyItem("a1", { custody: [{ quantity: 30, kitCustodyId: "kc1" }] }),
    });
    expect(activeIds(built)).toEqual(["qty-held-via-kit"]);
  });

  it("qty-nothing-held: nobody holds any units", () => {
    // Distinct from the kit case on purpose: telling an operator to scan a kit
    // for an asset that simply is not in custody sends them looking for one
    // that does not have it.
    const built = build("release", { qr1: qtyItem("a1", { custody: [] }) });
    expect(activeIds(built)).toEqual(["qty-nothing-held"]);
  });

  it("qty-several-holders: a release scan names no custodian", () => {
    const built = build("release", {
      qr1: qtyItem("a1", {
        custody: [
          { quantity: 5, kitCustodyId: null },
          { quantity: 3, kitCustodyId: null },
        ],
      }),
    });
    expect(activeIds(built)).toEqual(["qty-several-holders"]);
  });

  it("a kit holder does not make a single-holder asset look shared", () => {
    const built = build("release", {
      qr1: qtyItem("a1", {
        custody: [
          { quantity: 5, kitCustodyId: null },
          { quantity: 30, kitCustodyId: "kc1" },
        ],
      }),
    });
    expect(activeIds(built)).toEqual([]);
  });

  it("assets-not-in-custody: an individual asset nobody holds", () => {
    const built = build("release", {
      qr1: assetItem({ id: "a1", status: "AVAILABLE" }),
    });
    expect(activeIds(built)).toEqual(["assets-not-in-custody"]);
  });

  it("assets-part-of-kit: an individual member of a kit", () => {
    const built = build("release", {
      qr1: assetItem({
        id: "a1",
        status: "IN_CUSTODY",
        assetKits: [{ kitId: "k1" }] as never,
      }),
    });
    expect(activeIds(built)).toEqual(["assets-part-of-kit"]);
  });

  it("kits-not-in-custody: a kit nobody holds", () => {
    const built = build("release", { qr1: kitItem("k1") });
    expect(activeIds(built)).toEqual(["kits-not-in-custody"]);
  });

  it("invalid-codes: a code that resolved to nothing", () => {
    const built = build("release", { qr1: { error: "No such code" } });
    expect(activeIds(built)).toEqual(["invalid-codes"]);
  });

  it("resolve-all drops every blocked row, assets by id and kits by code", () => {
    const built = build("release", {
      qr1: qtyItem("a1", { custody: [] }),
      qr2: assetItem({ id: "a2", status: "AVAILABLE" }),
      qrKit: kitItem("k1"),
      qrBad: { error: "No such code" },
    });

    built.onResolveAll();

    expect(built.removeAssetsFromList).toHaveBeenCalledWith(
      expect.arrayContaining(["a1", "a2"])
    );
    expect(built.removeItemsFromList).toHaveBeenCalledWith(
      expect.arrayContaining(["qrKit", "qrBad"])
    );
  });
});
