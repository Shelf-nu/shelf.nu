import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the route re-reads the committed placement rows after the service
// call; stubbing the client avoids the real Prisma client (no DB in unit
// tests).
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findUniqueOrThrow: vi.fn() },
  },
}));

// why: `mobile-auth.server` transitively loads the Supabase admin client and
// the real Prisma client (no DB / env in unit tests). The route only calls
// these three gate functions.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: `replaceAssetPlacements` owns the placement invariants and has its
// own service suite. The route's observable job is gating + envelope
// shaping, so the service is stubbed and its failure modes simulated as the
// ShelfErrors it really throws.
vi.mock("~/modules/asset/service.server", () => ({
  replaceAssetPlacements: vi.fn(),
}));

// why: the in-memory limiter keeps state across tests; stubbing keeps runs
// order-independent.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { replaceAssetPlacements } from "~/modules/asset/service.server";
import { ShelfError } from "~/utils/error";
import { action } from "~/routes/api+/mobile+/asset.manage-placements";

/**
 * Tests for POST /api/mobile/asset/manage-placements — the mobile twin of
 * the web "Manage placements" dialog. Asserts observable behavior: the body
 * schema, the exact arguments handed to `replaceAssetPlacements`, the
 * response envelope (manual rows first, kit rows marked `viaKit`), and
 * service-error passthrough (the 409 concurrent-total conflict included).
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/asset.manage-placements.ts}
 */

/** Shape of the `data()` result the route action returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/** Runs the action with a JSON body and unwraps the data() envelope. */
async function callAction(body: unknown) {
  const request = new Request(
    "http://localhost/api/mobile/asset/manage-placements?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const result = await action({ request, params: {}, context: {} } as never);
  const { data, init } = result as unknown as DataResult<{
    asset?: { id: string; location: { id: string; name: string } | null };
    placements?: Array<{
      locationId: string;
      locationName: string;
      quantity: number;
      viaKit: { id: string; name: string } | null;
    }>;
    error?: { message: string };
  }>;
  return { body: data, status: init?.status ?? 200 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as never);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(requireMobilePermission).mockResolvedValue(undefined as never);
  vi.mocked(replaceAssetPlacements).mockResolvedValue(undefined as never);

  // why: cast — the route selects a narrow shape, not the full Asset row.
  // Default committed state: 4 at Storage (manual) + 5 at Van via a kit,
  // deliberately ordered kit-first so the manual-first response ordering is
  // observable.
  vi.mocked(db.asset.findUniqueOrThrow).mockResolvedValue({
    id: "asset-1",
    title: "Cords",
    assetLocations: [
      {
        quantity: 5,
        assetKitId: "ak-1",
        location: { id: "loc-van", name: "Van" },
        assetKit: { kit: { id: "kit-1", name: "Site kit" } },
      },
      {
        quantity: 4,
        assetKitId: null,
        location: { id: "loc-storage", name: "Storage" },
        assetKit: null,
      },
    ],
  } as never);
});

describe("POST /api/mobile/asset/manage-placements", () => {
  it("hands the full submitted set to the service and returns the committed rows", async () => {
    const { body, status } = await callAction({
      assetId: "asset-1",
      placements: [{ locationId: "loc-storage", quantity: 4 }],
    });

    expect(status).toBe(200);
    expect(replaceAssetPlacements).toHaveBeenCalledWith({
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
      placements: [{ locationId: "loc-storage", quantity: 4 }],
    });
    // Manual rows first, kit rows after, each kit row naming its kit.
    expect(body.placements).toEqual([
      {
        locationId: "loc-storage",
        locationName: "Storage",
        quantity: 4,
        viaKit: null,
      },
      {
        locationId: "loc-van",
        locationName: "Van",
        quantity: 5,
        viaKit: { id: "kit-1", name: "Site kit" },
      },
    ]);
  });

  it("accepts an empty set as a full unplace", async () => {
    const { status } = await callAction({ assetId: "asset-1", placements: [] });

    expect(status).toBe(200);
    expect(replaceAssetPlacements).toHaveBeenCalledWith(
      expect.objectContaining({ placements: [] })
    );
  });

  it("rejects a non-positive quantity via the body schema", async () => {
    const { status } = await callAction({
      assetId: "asset-1",
      placements: [{ locationId: "loc-storage", quantity: 0 }],
    });

    expect(status).toBe(400);
    expect(replaceAssetPlacements).not.toHaveBeenCalled();
  });

  it("rejects a payload whose placements is not an array", async () => {
    const { status } = await callAction({
      assetId: "asset-1",
      placements: "loc-storage",
    });

    expect(status).toBe(400);
    expect(replaceAssetPlacements).not.toHaveBeenCalled();
  });

  it("passes service failures through with their status", async () => {
    vi.mocked(replaceAssetPlacements).mockRejectedValue(
      new ShelfError({
        cause: null,
        title: "Quantity exceeds available pool",
        message:
          "The asset's total changed to 6 while you were editing. Submitted placements sum to 9. Reopen the dialog to see the current numbers.",
        status: 409,
        label: "Assets",
        shouldBeCaptured: false,
      })
    );

    const { body, status } = await callAction({
      assetId: "asset-1",
      placements: [{ locationId: "loc-storage", quantity: 9 }],
    });

    expect(status).toBe(409);
    expect(body.error?.message).toContain("total changed to 6");
  });

  it("refuses the caller without the asset-update permission", async () => {
    vi.mocked(requireMobilePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You are not allowed to update assets.",
        status: 403,
        label: "Assets",
        shouldBeCaptured: false,
      })
    );

    const { status } = await callAction({
      assetId: "asset-1",
      placements: [{ locationId: "loc-storage", quantity: 1 }],
    });

    expect(status).toBe(403);
    expect(replaceAssetPlacements).not.toHaveBeenCalled();
  });
});
