/**
 * "Select all" expands to the assets the list showed.
 *
 * `getAssetListWhereForSelectAll` runs the same two steps as the list loader
 * (`resolveAssetListFilters` then `buildAssetListWhere`). These tests pin the
 * rules each list applies that select-all has to carry over: the search id
 * set, the booking picker's availability rules, the kit picker's kit filter,
 * the list scope, low stock and the custodian refusal. The booking route test
 * compares a real loader's location ids with its select-all end to end.
 *
 * @see {@link file://./list-where.server.ts}
 */
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";
import { bookableListScopeWhere } from "./list-scope.server";
import { getAssetListWhereForSelectAll } from "./list-where.server";
import { buildLowStockWhere } from "./utils.server";

// why: the search UNION runs as raw SQL and low stock reads a field
// reference from the live client; both need a database, which unit tests do
// not have. Nothing else here touches it.
vi.mock("~/database/db.server", () => ({
  db: {
    $queryRaw: vi.fn(),
    asset: { fields: { minQuantity: "minQuantity" } },
  },
}));

const ORG = "org-1";

/** The options the kit, location and booking pickers' loaders pass. */
const pickerOptions = {
  allowedTeamMemberIds: [] as string[],
  bookableScope: null,
  locationIdsOverride: undefined,
  honorArchivedView: false,
  honorLowStockFilter: false,
};

/** Every group in `where.AND`, as an array. */
function andGroups(where: Prisma.AssetWhereInput) {
  return [where.AND ?? []].flat();
}

beforeEach(() => {
  vi.mocked(db.$queryRaw)
    .mockReset()
    .mockResolvedValue([{ id: "a1" }]);
});

describe("getAssetListWhereForSelectAll", () => {
  it("matches a search through the search id set, not the title alone", async () => {
    const where = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: "s=SN-4471",
      ...pickerOptions,
    });

    expect(where.title).toBeUndefined();
    expect(andGroups(where)).toContainEqual({ id: { in: ["a1"] } });
  });

  it("keeps the booking picker's availability rules", async () => {
    const where = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: new URLSearchParams({
        hideUnavailable: "true",
        bookingFrom: "2026-11-01T09:00:00.000Z",
        bookingTo: "2026-11-03T17:00:00.000Z",
        unhideAssetsBookigIds: "booking-1",
      }).toString(),
      ...pickerOptions,
    });

    // Unbookable assets and individual assets in kits stay out, as in the list.
    expect(where.availableToBook).toBe(true);
    expect(andGroups(where)).toContainEqual({
      OR: [{ type: "QUANTITY_TRACKED" }, { assetKits: { none: {} } }],
    });
    // The booking-window conflict rules apply, excluding this booking.
    expect(JSON.stringify(where.AND)).toContain('"notIn":["booking-1"]');
  });

  it("keeps the kit picker's kit filter", async () => {
    const where = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: "assetKitFilter=NOT_IN_KIT",
      ...pickerOptions,
    });

    expect(where.assetKits).toEqual({ none: {} });
  });

  it("applies the list scope of a member who sees only bookable assets", async () => {
    const scope = { holderUserId: "user-1" };
    const where = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: "",
      ...pickerOptions,
      bookableScope: scope,
    });

    expect(andGroups(where)).toContainEqual(bookableListScopeWhere(scope));
  });

  it("follows the list on low stock: honoured on the index, ignored on a picker", async () => {
    const onIndex = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: "lowStockOnly=true",
      ...pickerOptions,
      honorLowStockFilter: true,
    });
    const onPicker = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: "lowStockOnly=true",
      ...pickerOptions,
    });

    expect(andGroups(onIndex)).toContainEqual(buildLowStockWhere());
    expect(andGroups(onPicker)).not.toContainEqual(buildLowStockWhere());
  });

  it("refuses a custodian filter on a picker, as its list does", async () => {
    const where = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: "teamMember=tm-colleague",
      ...pickerOptions,
    });

    expect(andGroups(where)).toContainEqual({ id: CUSTODY_FILTER_REFUSED });
  });

  it("ignores a status that is not a real asset status", async () => {
    const where = await getAssetListWhereForSelectAll({
      organizationId: ORG,
      currentSearchParams: "status=is:AVAILABLE",
      ...pickerOptions,
    });

    expect(where.status).toBeUndefined();
  });
});
