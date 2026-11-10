// @vitest-environment node
/**
 * Each list's page loader hands its index query the same access-derived
 * arguments the index loader does, so the arrows step through exactly the
 * rows the user's own list shows. The index queries are mocked and their
 * arguments asserted; the access, scope and archive helpers run for real.
 *
 * @see {@link file://./registry.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { canViewArchivedAssets } from "~/modules/asset/data.server";
import { resolveBookableListScope } from "~/modules/asset/list-scope.server";
import {
  getAdvancedPaginatedAndFilterableAssets,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import {
  getBookings,
  getBookingsFilterData,
} from "~/modules/booking/service.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { getLocations } from "~/modules/location/service.server";
import type { ListNavigationCaller } from "./registry.server";
import { LIST_NAVIGATION_REGISTRY } from "./registry.server";

// why: the index queries hit the database; these tests pin the arguments
vi.mock("~/modules/asset/service.server", () => ({
  getAdvancedPaginatedAndFilterableAssets: vi.fn(),
  getPaginatedAndFilterableAssets: vi.fn(),
}));
// why: index settings are a database row
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn(),
}));
// why: the booking list queries hit the database
vi.mock("~/modules/booking/service.server", () => ({
  getBookings: vi.fn(),
  getBookingsFilterData: vi.fn(),
  getBookingsListWhereParams: vi.fn(() => ({})),
}));
// why: the kit list query hits the database
vi.mock("~/modules/kit/service.server", () => ({
  getPaginatedAndFilterableKits: vi.fn(),
}));
// why: the location list query hits the database
vi.mock("~/modules/location/service.server", () => ({
  getLocations: vi.fn(),
}));
// why: the advanced filters are read from a cookie-backed database preset
vi.mock("~/utils/cookies.server", () => ({
  getAdvancedFiltersFromRequest: vi.fn(() =>
    Promise.resolve({ filters: "page=1" })
  ),
  updateCookieWithPerPage: vi.fn(() => Promise.resolve({ perPage: 50 })),
}));
// why: the user's date preferences are a database row
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(() =>
    Promise.resolve({ timeZone: "Europe/Sofia" })
  ),
}));

const request = new Request("http://localhost/api/list-neighbours");
const listRequest = new Request("http://localhost/assets?page=1");

/** A neighbours caller, as the endpoint builds it from `requirePermission`. */
function callerFor(
  roles: OrganizationRoles[],
  organization: { type?: "PERSONAL" | "TEAM"; auditsEnabled?: boolean } = {}
): ListNavigationCaller {
  const context = permissionContext({ roles });
  return {
    ...context,
    userId: "user-1",
    canUseBarcodes: false,
    currentOrganization: {
      ...context.currentOrganization,
      type: organization.type ?? "TEAM",
      auditsEnabled: organization.auditsEnabled ?? true,
      barcodesEnabled: false,
    },
  } as unknown as ListNavigationCaller;
}

/** Loads one page of `entity` for `caller` and returns its ids. */
async function loadPage(
  entity: keyof typeof LIST_NAVIGATION_REGISTRY,
  caller: ListNavigationCaller
) {
  const fetchPage = await LIST_NAVIGATION_REGISTRY[entity].createPageFetcher({
    request,
    filters: "page=1",
    caller,
  });
  return fetchPage({ listRequest, filters: "page=1" });
}

describe("LIST_NAVIGATION_REGISTRY", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPaginatedAndFilterableAssets).mockResolvedValue({
      assets: [{ id: "a1" }],
    } as never);
    vi.mocked(getAdvancedPaginatedAndFilterableAssets).mockResolvedValue({
      assets: [{ id: "a1" }],
    } as never);
    vi.mocked(getBookingsFilterData).mockResolvedValue({
      page: 1,
      perPage: 20,
      orderBy: "from",
      orderDirection: "asc",
      selfServiceData: null,
      searchParams: new URLSearchParams(),
    } as never);
    vi.mocked(getBookings).mockResolvedValue({
      bookings: [{ id: "b1" }],
    } as never);
    vi.mocked(getPaginatedAndFilterableKits).mockResolvedValue({
      kits: [{ id: "k1" }],
    } as never);
    vi.mocked(getLocations).mockResolvedValue({
      locations: [{ id: "l1" }],
    } as never);
  });

  describe("asset, simple mode", () => {
    beforeEach(() => {
      vi.mocked(getAssetIndexSettings).mockResolvedValue({
        mode: "SIMPLE",
        columns: [],
      } as never);
    });

    it.each([[OrganizationRoles.ADMIN], [OrganizationRoles.BASE]])(
      "passes the %s caller's custody, scope and archive rules",
      async (role) => {
        const caller = callerFor([role]);
        expect(await loadPage("asset", caller)).toEqual(["a1"]);

        expect(getPaginatedAndFilterableAssets).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: caller.organizationId,
            userId: "user-1",
            canSeeAllCustody: caller.access.custody.seeAll,
            honorArchivedView: canViewArchivedAssets(caller.access),
            honorLowStockFilter: true,
            bookableScope: resolveBookableListScope({
              access: caller.access,
              userId: "user-1",
            }),
          })
        );
      }
    );
  });

  describe("asset, advanced mode", () => {
    beforeEach(() => {
      vi.mocked(getAssetIndexSettings).mockResolvedValue({
        mode: "ADVANCED",
        columns: [{ name: "lastAuditDate", visible: true, position: 1 }],
      } as never);
    });

    it("honours the last audit date for a caller who may query it", async () => {
      await loadPage("asset", callerFor([OrganizationRoles.ADMIN]));

      expect(getAdvancedPaginatedAndFilterableAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          lastAuditDateAccess: "available",
          timeZone: "Europe/Sofia",
        })
      );
    });

    it("locks the last audit date when the workspace has no audits", async () => {
      await loadPage(
        "asset",
        callerFor([OrganizationRoles.ADMIN], { auditsEnabled: false })
      );

      // Locked keeps the column on screen but must not reach the query.
      expect(getAdvancedPaginatedAndFilterableAssets).toHaveBeenCalledWith(
        expect.objectContaining({ lastAuditDateAccess: "locked" })
      );
    });

    it("lists nothing for a role the advanced index refuses", async () => {
      expect(
        await loadPage("asset", callerFor([OrganizationRoles.BASE]))
      ).toEqual([]);
      expect(getAdvancedPaginatedAndFilterableAssets).not.toHaveBeenCalled();
    });
  });

  describe("booking", () => {
    it("reads the caller's booking reach", async () => {
      const caller = callerFor([OrganizationRoles.SELF_SERVICE]);
      expect(await loadPage("booking", caller)).toEqual(["b1"]);

      expect(getBookingsFilterData).toHaveBeenCalledWith(
        expect.objectContaining({
          canSeeAllBookings: caller.access.bookings.seeAll,
          organizationId: caller.organizationId,
          userId: "user-1",
        })
      );
    });

    it("lists nothing in a personal workspace", async () => {
      const caller = callerFor([OrganizationRoles.OWNER], {
        type: "PERSONAL",
      });
      expect(await loadPage("booking", caller)).toEqual([]);
      expect(getBookings).not.toHaveBeenCalled();
    });
  });

  it("kit: passes the custody reach and the index's member include", async () => {
    const caller = callerFor([OrganizationRoles.BASE]);
    expect(await loadPage("kit", caller)).toEqual(["k1"]);

    expect(getPaginatedAndFilterableKits).toHaveBeenCalledWith(
      expect.objectContaining({
        canSeeAllCustody: caller.access.custody.seeAll,
        userId: "user-1",
        extraInclude: {
          assetKits: {
            where: { asset: { archivedAt: null } },
            select: { id: true },
          },
        },
      })
    );
  });

  it("location: pages with the per-page size the index reads", async () => {
    const caller = callerFor([OrganizationRoles.ADMIN]);
    expect(await loadPage("location", caller)).toEqual(["l1"]);

    expect(getLocations).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: caller.organizationId,
        page: 1,
        perPage: 50,
      })
    );
  });
});
