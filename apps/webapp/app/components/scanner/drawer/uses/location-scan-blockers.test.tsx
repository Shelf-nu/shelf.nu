/**
 * Every blocker the two location scanner drawers can raise, one case each.
 *
 * The contract these pin: for each blocker id, a row in that state raises it,
 * and a healthy row does not. `EXPECTED_*_IDS` pins each set, so adding a
 * blocker without a case here fails rather than passing silently.
 *
 * @see {@link file://./location-scan-blockers.tsx}
 */

import { describe, expect, it, vi } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";

import {
  buildAddToLocationBlockers,
  buildUpdateLocationBlockers,
} from "./location-scan-blockers";
import type { ScanBlockers } from "./scan-blocker-helpers";

/** Every blocker the add-to-location drawer declares, in order. */
const EXPECTED_ADD_IDS = [
  "assets-already-added",
  "kits-already-added",
  "assets-archived",
  "invalid-codes",
];

/** Every blocker the update-location drawer declares, in order. */
const EXPECTED_UPDATE_IDS = ["assets-archived", "invalid-codes"];

/** A scanned asset row, cut down to the fields the blockers read. */
function assetItem(asset: Partial<AssetFromQr> & { id: string }) {
  return {
    type: "asset" as const,
    data: {
      type: "INDIVIDUAL",
      status: "AVAILABLE",
      archivedAt: null,
      ...asset,
    } as unknown as AssetFromQr,
  };
}

/** A scanned kit row whose every member is archived. */
function archivedOnlyKitItem(id: string) {
  return {
    type: "kit" as const,
    data: {
      id,
      status: "AVAILABLE",
      assetKits: [{ asset: { id: `${id}-m0`, archivedAt: "2026-10-01" } }],
    } as never,
  };
}

/** Spies for the two removers. */
function removers() {
  return { removeAssetsFromList: vi.fn(), removeItemsFromList: vi.fn() };
}

/** Builds the add-to-location list for a location holding the given ids. */
function buildAdd(
  items: ScanListItems,
  {
    assetIds = [],
    kitIds = [],
  }: { assetIds?: string[]; kitIds?: string[] } = {}
) {
  const spies = removers();
  return {
    ...buildAddToLocationBlockers({
      items,
      locationAssetIds: new Set(assetIds),
      locationKitIds: new Set(kitIds),
      ...spies,
    }),
    ...spies,
  };
}

/** Builds the update-location list. */
function buildUpdate(items: ScanListItems) {
  const spies = removers();
  return { ...buildUpdateLocationBlockers({ items, ...spies }), ...spies };
}

/** Ids of the blockers currently firing. */
function activeIds(built: ScanBlockers): string[] {
  return built.blockerConfigs.filter((b) => b.condition).map((b) => b.id ?? "");
}

/** Every id a remove spy was asked to drop, across all its calls. */
function removedBy(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.flatMap(([ids]) => ids as string[]);
}

describe("buildAddToLocationBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    expect(buildAdd({}).blockerConfigs.map((b) => b.id)).toEqual(
      EXPECTED_ADD_IDS
    );
  });

  it("raises nothing for a healthy scan", () => {
    expect(activeIds(buildAdd({ qr1: assetItem({ id: "a1" }) }))).toEqual([]);
  });

  it("assets-archived: an archived asset, which still reads AVAILABLE", () => {
    const built = buildAdd({
      qr1: assetItem({ id: "a1", archivedAt: new Date() }),
      qr2: assetItem({ id: "a2" }),
    });
    expect(activeIds(built)).toEqual(["assets-archived"]);
    built.blockerConfigs.find((b) => b.id === "assets-archived")?.onResolve();
    expect(removedBy(built.removeAssetsFromList)).toEqual(["a1"]);
  });

  it("does not block a kit whose members are all archived", () => {
    // Moving a kit leaves an archived member's placement alone.
    expect(activeIds(buildAdd({ qr1: archivedOnlyKitItem("k1") }))).toEqual([]);
  });

  it("assets-already-added: an asset placed here already", () => {
    const built = buildAdd(
      { qr1: assetItem({ id: "a1" }) },
      { assetIds: ["a1"] }
    );
    expect(activeIds(built)).toEqual(["assets-already-added"]);
  });

  it("kits-already-added: a kit here already, removed by its code", () => {
    const built = buildAdd(
      { qrKit: { type: "kit", data: { id: "k1", assetKits: [] } as never } },
      { kitIds: ["k1"] }
    );
    expect(activeIds(built)).toEqual(["kits-already-added"]);
    built.blockerConfigs
      .find((b) => b.id === "kits-already-added")
      ?.onResolve();
    expect(removedBy(built.removeItemsFromList)).toEqual(["qrKit"]);
  });

  it("invalid-codes: a code that resolved to nothing", () => {
    expect(activeIds(buildAdd({ qr1: { error: "No such code" } }))).toEqual([
      "invalid-codes",
    ]);
  });
});

describe("buildUpdateLocationBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    expect(buildUpdate({}).blockerConfigs.map((b) => b.id)).toEqual(
      EXPECTED_UPDATE_IDS
    );
  });

  it("raises nothing for a healthy scan", () => {
    expect(
      activeIds(
        buildUpdate({
          qr1: assetItem({ id: "a1" }),
          qr2: archivedOnlyKitItem("k1"),
        })
      )
    ).toEqual([]);
  });

  it("assets-archived: an archived asset, which still reads AVAILABLE", () => {
    const built = buildUpdate({
      qr1: assetItem({ id: "a1", archivedAt: new Date() }),
    });
    expect(activeIds(built)).toEqual(["assets-archived"]);
    built.blockerConfigs.find((b) => b.id === "assets-archived")?.onResolve();
    expect(removedBy(built.removeAssetsFromList)).toEqual(["a1"]);
  });

  it("invalid-codes: a code that resolved to nothing", () => {
    expect(activeIds(buildUpdate({ qr1: { error: "No such code" } }))).toEqual([
      "invalid-codes",
    ]);
  });
});
