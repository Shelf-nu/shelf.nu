/**
 * Route loader tests for `kits.$kitId.assets.tsx`.
 *
 * The route is gated on `kit`/`read`, which SELF_SERVICE and BASE both hold —
 * but the reserved-booking removal warning it ships names RESERVED bookings
 * from across the whole organization, which those roles otherwise never see,
 * and describes a removal they have no permission to perform. These tests pin
 * that the warning data is computed (and shipped) only for callers with
 * `kit`/`update`.
 *
 * @see {@link file://./../../app/routes/_layout+/kits.$kitId.assets.tsx}
 */

import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAssetsForKits,
  getReservedBookingImpactForAssetKits,
} from "~/modules/kit/service.server";
import { loader } from "~/routes/_layout+/kits.$kitId.assets";
import { requirePermission } from "~/utils/roles.server";

const dbMocks = vi.hoisted(() => ({
  kit: { findFirst: vi.fn() },
}));

vi.mock("~/database/db.server", () => ({
  db: { kit: { findFirst: dbMocks.kit.findFirst } },
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the loader's two data reads are exercised elsewhere
// (kit/service.server.test.ts); here we only care about WHETHER the reserved
// impact read happens for a given role.
vi.mock("~/modules/kit/service.server", () => ({
  getAssetsForKits: vi.fn(),
  getReservedBookingImpactForAssetKits: vi.fn().mockResolvedValue({}),
}));

// why: the route module imports the asset-index filter/list UI, which
// transitively pulls in side-effecting modules that crash on load under
// happy-dom. Only the `loader` export is exercised here.
vi.mock("~/components/assets/assets-index/filters", () => ({
  ASSET_SORTING_OPTIONS: [],
}));
vi.mock("~/components/location/scan-details", () => ({
  ScanDetails: () => null,
}));

const requirePermissionMock = vi.mocked(requirePermission);
const getAssetsForKitsMock = vi.mocked(getAssetsForKits);
const reservedImpactMock = vi.mocked(getReservedBookingImpactForAssetKits);

/** One kit member holding membership `ak-1`, enough to drive the impact read. */
const KIT_MEMBER = {
  id: "asset-1",
  title: "Switch A",
  assetKits: [{ id: "ak-1", kitId: "kit-123", quantity: 1 }],
};

/**
 * Points `requirePermission` at a membership carrying `role`, the shape the
 * loader reads to derive its second permission check.
 */
function mockRole(role: OrganizationRoles) {
  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
    userOrganizations: [{ organization: { id: "org-1" }, roles: [role] }],
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
}

function createLoaderArgs(): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-123" }) },
    request: new Request("https://example.com/kits/kit-123/assets"),
    params: { kitId: "kit-123" },
  } as unknown as LoaderFunctionArgs;
}

describe("kits.$kitId.assets loader — reserved-booking warning gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.kit.findFirst.mockResolvedValue({ name: "Rack Kit" });
    getAssetsForKitsMock.mockResolvedValue({
      items: [KIT_MEMBER],
    } as unknown as Awaited<ReturnType<typeof getAssetsForKits>>);
    reservedImpactMock.mockResolvedValue({
      "ak-1": [{ id: "booking-1", name: "Acme Corp — Q3 rollout" }],
    });
  });

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "never ships reserved booking names to %s, which cannot remove kit assets",
    async (role) => {
      // why: booking names routinely carry customer / project identifiers, and
      // these roles normally see only bookings they created or hold. The route
      // only requires `kit`/`read`, so without this gate `kit: [read]` is
      // enough to enumerate every RESERVED booking holding the kit's assets.
      expect.assertions(2);

      mockRole(role);

      const result = await loader(createLoaderArgs());

      expect(result).not.toHaveProperty("reservedBookingsByAssetId");
      // Not merely withheld from the payload — never read at all.
      expect(reservedImpactMock).not.toHaveBeenCalled();
    }
  );

  it("ships the warning to a role that can actually remove the asset", async () => {
    // why: the gate must not break the feature for the roles it is meant for —
    // ADMIN has `kit`/`update`, so the Remove dialog still gets its warning.
    expect.assertions(2);

    mockRole(OrganizationRoles.ADMIN);

    const result = await loader(createLoaderArgs());

    expect(reservedImpactMock).toHaveBeenCalledWith({
      assetKitIds: ["ak-1"],
      organizationId: "org-1",
    });
    expect(result).toHaveProperty("reservedBookingsByAssetId", {
      "asset-1": [{ id: "booking-1", name: "Acme Corp — Q3 rollout" }],
    });
  });
});
