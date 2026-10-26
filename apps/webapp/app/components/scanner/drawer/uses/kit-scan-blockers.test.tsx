/**
 * Every blocker the add-assets-to-kit drawer can raise, one case each.
 *
 * The contract these pin: for each blocker id, a row in that state raises it,
 * and a healthy row does not. `EXPECTED_IDS` pins the set itself, so adding a
 * blocker without a case here fails rather than passing silently.
 *
 * @see {@link file://./kit-scan-blockers.tsx}
 */

import { describe, expect, it, vi } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

import { buildAddToKitBlockers } from "./kit-scan-blockers";
import type { ScanBlockers } from "./scan-blocker-helpers";

/** Every blocker the drawer declares, in order. */
const EXPECTED_IDS = [
  "assets-already-added",
  "assets-with-custody",
  "assets-checked-out",
  "kits-not-allowed",
  "assets-archived",
  "invalid-codes",
];

/** The kit the drawer adds to. */
const KIT_ID = "kit-target";

/** A scanned asset row, cut down to the fields the blockers read. */
function assetItem(asset: Partial<AssetFromQr> & { id: string }) {
  return {
    type: "asset" as const,
    data: {
      type: "INDIVIDUAL",
      status: "AVAILABLE",
      archivedAt: null,
      assetKits: [],
      custody: [],
      ...asset,
    } as unknown as AssetFromQr,
  };
}

/** Builds with spies so resolve wiring can be asserted too. */
function build(items: ScanListItems, kitAssetIds: string[] = []) {
  const removeAssetsFromList = vi.fn();
  const removeItemsFromList = vi.fn();
  return {
    ...buildAddToKitBlockers({
      items,
      kitId: KIT_ID,
      kitAssetIds: new Set(kitAssetIds),
      removeAssetsFromList,
      removeItemsFromList,
    }),
    removeAssetsFromList,
    removeItemsFromList,
  };
}

/** Ids of the blockers currently firing. */
function activeIds(built: ScanBlockers): string[] {
  return built.blockerConfigs.filter((b) => b.condition).map((b) => b.id ?? "");
}

/** Every id a remove spy was asked to drop, across all its calls. */
function removedBy(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.flatMap(([ids]) => ids as string[]);
}

describe("buildAddToKitBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    expect(build({}).blockerConfigs.map((b) => b.id)).toEqual(EXPECTED_IDS);
  });

  it("raises nothing for a healthy scan", () => {
    expect(activeIds(build({ qr1: assetItem({ id: "a1" }) }))).toEqual([]);
  });

  it("assets-archived: an archived asset, which still reads AVAILABLE", () => {
    const built = build({
      qr1: assetItem({ id: "a1", archivedAt: new Date() }),
      qr2: assetItem({ id: "a2" }),
    });
    expect(activeIds(built)).toEqual(["assets-archived"]);
    built.blockerConfigs.find((b) => b.id === "assets-archived")?.onResolve();
    expect(removedBy(built.removeAssetsFromList)).toEqual(["a1"]);
  });

  it("assets-already-added: a member of this kit", () => {
    const built = build({ qr1: assetItem({ id: "a1" }) }, ["a1"]);
    expect(activeIds(built)).toEqual(["assets-already-added"]);
  });

  it("assets-with-custody: custody held outside this kit", () => {
    const custody = [{ id: "c1" }] as never;
    expect(activeIds(build({ qr1: assetItem({ id: "a1", custody }) }))).toEqual(
      ["assets-with-custody"]
    );
    // Custody that comes from this kit is not a reason to refuse.
    expect(
      activeIds(
        build({
          qr1: assetItem({
            id: "a1",
            custody,
            assetKits: [{ kitId: KIT_ID }] as never,
          }),
        })
      )
    ).toEqual([]);
  });

  it("assets-checked-out: an asset out on a booking", () => {
    const built = build({
      qr1: assetItem({ id: "a1", status: "CHECKED_OUT" }),
    });
    expect(activeIds(built)).toEqual(["assets-checked-out"]);
  });

  it("kits-not-allowed: any scanned kit, keyed by its code", () => {
    const built = build({
      qrKit: { type: "kit", data: { id: "k1", assetKits: [] } as never },
    });
    expect(activeIds(built)).toEqual(["kits-not-allowed"]);
    built.blockerConfigs.find((b) => b.id === "kits-not-allowed")?.onResolve();
    expect(removedBy(built.removeItemsFromList)).toEqual(["qrKit"]);
  });

  it("invalid-codes: a code that resolved to nothing", () => {
    const built = build({ qr1: { error: "No such code" } });
    expect(activeIds(built)).toEqual(["invalid-codes"]);
  });
});
