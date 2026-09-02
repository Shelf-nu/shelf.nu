/**
 * Tests for POST /api/mobile/asset/update-location — the mobile twin of the
 * web asset-overview "Update location" dialog. Asserts observable behavior:
 * the per-placement `quantity` handling for QUANTITY_TRACKED assets (partial
 * placement, pool bound, INDIVIDUAL ignoring it), the no-op short-circuit,
 * and the quantity-aware event meta + note phrasing.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/asset.update-location.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the route pre-reads the asset + location and opens an interactive
// transaction; stubbing the client avoids the real Prisma client (no DB in
// unit tests). `$transaction` runs its callback against a tx stub so the
// pivot writes and the in-tx re-read stay observable.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findUnique: vi.fn() },
    location: { findFirst: vi.fn() },
    $transaction: vi.fn(),
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

// why: the lock helper issues a raw `SELECT ... FOR UPDATE`; the test drives
// the quantity validation through its resolved value instead of a DB.
vi.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vi.fn(),
}));

// why: side-effect writers with their own suites — the route's observable
// job here is WHAT it hands them (event meta quantity, note phrasing).
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
}));
// why: `createNote` writes through the real Prisma client. The note's wording
// is the observable output under test, so the writer is stubbed and the content
// asserted from the call.
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { createNote } from "~/modules/note/service.server";
import { action } from "~/routes/api+/mobile+/asset.update-location";

/** Shape of the `data()` result the route action returns. */
type DataResult<T> = { data: T; init: ResponseInit | null };

/** Runs the action with a JSON body and unwraps the data() envelope. */
async function callAction(body: unknown) {
  const request = new Request(
    "http://localhost/api/mobile/asset/update-location?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const result = await action({ request, params: {}, context: {} } as never);
  const { data, init } = result as unknown as DataResult<{
    asset?: { id: string; location: { id: string; name: string } | null };
    placedQuantity?: number;
    error?: { message: string };
  }>;
  return { body: data, status: init?.status ?? 200 };
}

/** Tx stub handed to the `$transaction` callback. */
const tx = {
  assetLocation: { deleteMany: vi.fn(), create: vi.fn() },
  asset: { findUniqueOrThrow: vi.fn() },
};

/**
 * A QUANTITY_TRACKED asset with 10 units, all placed at Storage. Individual
 * tests override the pieces their branch exercises.
 */
function qtyAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    title: "Cords",
    type: "QUANTITY_TRACKED",
    quantity: 10,
    unitOfMeasure: "pcs",
    assetLocations: [
      {
        quantity: 10,
        location: { id: "loc-storage", name: "Storage" },
      },
    ],
    assetKits: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: {
      id: "user-1",
      firstName: "Carla",
      lastName: "Tester",
      displayName: null,
    },
  } as never);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(requireMobilePermission).mockResolvedValue(undefined as never);

  // why: cast — the route selects narrow shapes, not full rows.
  vi.mocked(db.asset.findUnique).mockResolvedValue(qtyAsset() as never);
  vi.mocked(db.location.findFirst).mockResolvedValue({
    id: "loc-van",
    name: "Van",
  } as never);
  vi.mocked(db.$transaction).mockImplementation((async (cb: never) =>
    (cb as (t: typeof tx) => Promise<unknown>)(tx)) as never);
  vi.mocked(lockAssetForQuantityUpdate).mockResolvedValue(qtyAsset() as never);
  tx.asset.findUniqueOrThrow.mockResolvedValue({
    id: "asset-1",
    title: "Cords",
    assetLocations: [{ location: { id: "loc-van", name: "Van" } }],
  });
});

describe("POST /api/mobile/asset/update-location", () => {
  it("places a partial quantity and reports it back", async () => {
    const { body, status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-van",
      quantity: 4,
    });

    expect(status).toBe(200);
    expect(body.placedQuantity).toBe(4);
    expect(body.asset?.location).toEqual({ id: "loc-van", name: "Van" });
    expect(tx.assetLocation.create).toHaveBeenCalledWith({
      data: {
        assetId: "asset-1",
        locationId: "loc-van",
        organizationId: "org-1",
        quantity: 4,
      },
    });
    // The replace clears manual rows only — kit-driven rows are the kit
    // flow's to manage.
    expect(tx.assetLocation.deleteMany).toHaveBeenCalledWith({
      where: { assetId: "asset-1", assetKitId: null },
    });
  });

  it("records the placed quantity on the event and in the note", async () => {
    await callAction({
      assetId: "asset-1",
      locationId: "loc-van",
      quantity: 4,
    });

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ASSET_LOCATION_CHANGED",
        fromValue: "loc-storage",
        toValue: "loc-van",
        meta: { quantity: 4 },
      }),
      tx
    );
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("moved 4 pcs from"),
      })
    );
  });

  it("places the full pool when quantity is omitted", async () => {
    const { body, status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-van",
    });

    expect(status).toBe(200);
    expect(body.placedQuantity).toBe(10);
    expect(tx.assetLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 10 }),
    });
  });

  it("rejects a quantity above the asset's total pool", async () => {
    const { body, status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-van",
      quantity: 11,
    });

    expect(status).toBe(400);
    expect(body.error?.message).toContain("Requested 11");
    expect(tx.assetLocation.create).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity via the body schema", async () => {
    const { status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-van",
      quantity: 0,
    });

    expect(status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("ignores quantity for INDIVIDUAL assets (placement is always 1)", async () => {
    const individual = qtyAsset({
      type: "INDIVIDUAL",
      quantity: null,
      unitOfMeasure: null,
    });
    vi.mocked(db.asset.findUnique).mockResolvedValue(individual as never);
    vi.mocked(lockAssetForQuantityUpdate).mockResolvedValue(
      individual as never
    );

    const { body, status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-van",
      quantity: 4,
    });

    expect(status).toBe(200);
    expect(body.placedQuantity).toBe(1);
    expect(tx.assetLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 1 }),
    });
    // INDIVIDUAL keeps the original phrasing — no unit count.
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("updated the location from"),
      })
    );
  });

  it("short-circuits when location and quantity are both unchanged", async () => {
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "loc-storage",
      name: "Storage",
    } as never);

    const { body, status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-storage",
      quantity: 10,
    });

    expect(status).toBe(200);
    expect(body.asset?.location).toEqual({
      id: "loc-storage",
      name: "Storage",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("re-places at the same location when the quantity differs", async () => {
    tx.asset.findUniqueOrThrow.mockResolvedValue({
      id: "asset-1",
      title: "Cords",
      assetLocations: [{ location: { id: "loc-storage", name: "Storage" } }],
    });
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "loc-storage",
      name: "Storage",
    } as never);

    const { body, status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-storage",
      quantity: 6,
    });

    expect(status).toBe(200);
    expect(body.placedQuantity).toBe(6);
    expect(tx.assetLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 6 }),
    });
  });

  it("still writes through when a multi-placement collapses (the app warns first)", async () => {
    vi.mocked(db.asset.findUnique).mockResolvedValue(
      qtyAsset({
        assetLocations: [
          { quantity: 6, location: { id: "loc-storage", name: "Storage" } },
          { quantity: 4, location: { id: "loc-van", name: "Van" } },
        ],
      }) as never
    );
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "loc-storage",
      name: "Storage",
    } as never);

    const { status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-storage",
      quantity: 6,
    });

    // Same primary location + same row quantity, but a second placement
    // exists — the replace is a real change (it collapses the other row).
    expect(status).toBe(200);
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("records the placement it collapsed, not just the one it kept", async () => {
    vi.mocked(db.asset.findUnique).mockResolvedValue(
      qtyAsset({
        assetLocations: [
          { quantity: 6, location: { id: "loc-storage", name: "Storage" } },
          { quantity: 4, location: { id: "loc-van", name: "Van" } },
        ],
      }) as never
    );
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "loc-storage",
      name: "Storage",
    } as never);

    await callAction({
      assetId: "asset-1",
      locationId: "loc-storage",
      quantity: 6,
    });

    // The Van row is deleted by the pivot replace. Without its own event the
    // asset silently stops being at the Van while reports still show it there.
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ASSET_LOCATION_CHANGED",
        assetId: "asset-1",
        fromValue: "loc-van",
        toValue: null,
      }),
      expect.anything()
    );
  });

  it("places the full pool when quantity is omitted at the current location", async () => {
    // 4 of 10 units are placed at Storage and the caller asks for Storage with
    // no quantity, which means the whole pool. Reading the omission as
    // "unchanged" short-circuits and leaves 4 placed.
    vi.mocked(db.asset.findUnique).mockResolvedValue(
      qtyAsset({
        assetLocations: [
          { quantity: 4, location: { id: "loc-storage", name: "Storage" } },
        ],
      }) as never
    );
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "loc-storage",
      name: "Storage",
    } as never);

    const { status } = await callAction({
      assetId: "asset-1",
      locationId: "loc-storage",
    });

    expect(status).toBe(200);
    expect(
      db.$transaction,
      "the placement must be rewritten to 10"
    ).toHaveBeenCalled();
    expect(tx.assetLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 10 }),
      })
    );
  });

  it("describes a same-location edit as a quantity change, not a move", async () => {
    vi.mocked(db.asset.findUnique).mockResolvedValue(
      qtyAsset({
        assetLocations: [
          { quantity: 4, location: { id: "loc-storage", name: "Storage" } },
        ],
      }) as never
    );
    vi.mocked(db.location.findFirst).mockResolvedValue({
      id: "loc-storage",
      name: "Storage",
    } as never);
    tx.asset.findUniqueOrThrow.mockResolvedValue({
      id: "asset-1",
      title: "Cords",
      assetLocations: [{ location: { id: "loc-storage", name: "Storage" } }],
    });

    await callAction({
      assetId: "asset-1",
      locationId: "loc-storage",
      quantity: 6,
    });

    const note = vi.mocked(createNote).mock.calls[0][0].content as string;
    expect(
      note,
      "nothing moved, so the note must not describe a journey"
    ).not.toMatch(/moved .* from .* to /);
    expect(note).toContain("changed the quantity");
  });
});
