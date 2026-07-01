import { beforeEach, describe, expect, it, vi } from "vitest";

// why: stub location note creation to isolate location service tests from note side effects
const locationNoteMocks = vi.hoisted(() => ({
  createSystemLocationNote: vi.fn(),
  createLocationNote: vi.fn(),
}));

// why: mock database client to test location service without real DB operations
const dbMocks = vi.hoisted(() => ({
  // why: location model stubs for CRUD operations tested in location service
  location: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    findFirstOrThrow: vi.fn(),
    create: vi.fn(),
  },
  // why: asset model stubs for bulk location changes (moveAssetsToNewLocation)
  asset: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    // why: org-scope assertion in updateLocationAssets calls db.asset.count
    count: vi.fn(),
  },
  // why: placement lives on the AssetLocation pivot (not Asset.locationId).
  // updateLocationAssets/updateLocationKits create/delete pivot rows
  // directly inside the transaction, so the delegate must be mockable.
  assetLocation: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    // why: qty-edit branch uses `updateMany` scoped to `assetKitId IS NULL`
    // because the (assetId, locationId) composite is no longer unique
    // (manual + kit-driven rows can coexist).
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  // why: kit model stubs for fetching kits affected by location changes
  kit: {
    findMany: vi.fn(),
    // why: org-scope assertion in updateLocationKits calls db.kit.count
    count: vi.fn(),
  },
  // why: kit-driven AssetLocation cascade in `updateLocationKits`
  // re-creates rows from the matching AssetKit rows; the cascade
  // fetches them inside the tx.
  assetKit: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  // why: user model stubs for resolving actor info in activity events
  user: {
    findUniqueOrThrow: vi.fn(),
    findFirstOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  // why: transaction proxy to route calls to mocked clients for atomic operations
  $transaction: vi.fn().mockImplementation((cb: any) => {
    const txClient = {
      location: dbMocks.location,
      asset: dbMocks.asset,
      assetLocation: dbMocks.assetLocation,
      assetKit: dbMocks.assetKit,
      kit: dbMocks.kit,
      user: dbMocks.user,
    };
    return cb(txClient);
  }),
}));

const geolocateMock = vi.hoisted(() => vi.fn());
const createNoteMock = vi.hoisted(() => vi.fn());
const getUserByIDMock = vi.hoisted(() => vi.fn());

vi.mock("~/database/db.server", () => ({
  db: dbMocks,
}));

vi.mock("~/utils/geolocate.server", () => ({
  geolocate: geolocateMock,
}));

vi.mock("~/modules/location-note/service.server", () => ({
  createSystemLocationNote: locationNoteMocks.createSystemLocationNote,
  createLocationNote: locationNoteMocks.createLocationNote,
}));

vi.mock("~/modules/note/service.server", () => ({
  createNote: createNoteMock,
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: getUserByIDMock,
}));

// why: testing location service without executing actual activity event recording
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
  recordEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/modules/asset/utils.server", () => ({
  getAssetsWhereInput: vi.fn(() => ({})),
  getLocationUpdateNoteContent: vi.fn(() => "asset note"),
  getKitLocationUpdateNoteContent: vi.fn(() => "kit asset note"),
}));

vi.mock("~/modules/kit/utils.server", () => ({
  getKitsWhereInput: vi.fn(() => ({})),
}));

vi.mock("~/utils/http.server", () => ({
  getCurrentSearchParams: () => new URLSearchParams(),
}));

vi.mock("~/utils/list", async () => {
  const actual = await vi.importActual("~/utils/list");
  return { ...actual, ALL_SELECTED_KEY: "__ALL__" };
});

vi.mock("~/utils/error", () => {
  class ShelfError extends Error {
    constructor(config: any) {
      super(config.message || "ShelfError");
      Object.assign(this, config);
    }
  }
  return {
    ShelfError,
    // why: production behavior re-throws known ShelfErrors so callers see the
    // original status (e.g. 403 from the org-scope guard) instead of a
    // generic 500 wrap from the outer catch
    isLikeShelfError: (cause: unknown) => cause instanceof ShelfError,
    isNotFoundError: () => false,
    maybeUniqueConstraintViolation: (
      _cause: unknown,
      _label: string,
      _meta?: any
    ) => {
      throw _cause;
    },
  };
});

const {
  updateLocation,
  updateLocationAssets,
  updateLocationKits,
  createLocationChangeNote,
} = await import("./service.server");

describe("location service activity logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMocks.location.findUniqueOrThrow.mockResolvedValue({
      id: "loc-1",
      organizationId: "org-1",
      address: "Old St",
      latitude: null,
      longitude: null,
      // Placement comes from the AssetLocation pivot, not a direct `assets`
      // relation. updateLocationAssets reads `location.assetLocations` to
      // derive the current placement set.
      assetLocations: [],
      kits: [],
    });

    dbMocks.location.update.mockResolvedValue({ id: "loc-1" });
    geolocateMock.mockResolvedValue(null);
    dbMocks.asset.findMany.mockResolvedValue([]);
    dbMocks.user.findFirstOrThrow.mockResolvedValue({
      firstName: "Jane",
      lastName: "Doe",
    });
    dbMocks.user.findFirst.mockResolvedValue({
      firstName: "Jane",
      lastName: "Doe",
    });
    dbMocks.kit.findMany.mockResolvedValue([]);
    // why: assertion helpers count submitted IDs; default to "all authorized"
    // so happy-path tests don't have to wire it up explicitly
    dbMocks.asset.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.id?.in?.length ?? 0)
    );
    dbMocks.kit.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.id?.in?.length ?? 0)
    );
    locationNoteMocks.createSystemLocationNote.mockResolvedValue(undefined);
    locationNoteMocks.createLocationNote.mockResolvedValue(undefined);
    createNoteMock.mockResolvedValue(undefined);
    getUserByIDMock.mockResolvedValue({ firstName: "Jane", lastName: "Doe" });
  });

  describe("updateLocation", () => {
    it("records a system note when key fields change", async () => {
      dbMocks.location.findUniqueOrThrow.mockResolvedValueOnce({
        id: "loc-1",
        name: "Old Name",
        description: "Old description",
        address: "Old St",
        latitude: null,
        longitude: null,
        organizationId: "org-1",
      });

      await updateLocation({
        id: "loc-1",
        name: "New Name",
        description: "New description",
        address: "New Ave",
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(locationNoteMocks.createSystemLocationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          locationId: "loc-1",
          content: expect.stringContaining("New Name"),
        })
      );
    });
  });

  describe("createLocationChangeNote", () => {
    it("creates an asset note for the location change", async () => {
      await createLocationChangeNote({
        currentLocation: { id: "loc-1", name: "Old" },
        newLocation: { id: "loc-2", name: "New" },
        firstName: "Ada",
        lastName: "Lovelace",
        assetId: "asset-1",
        userId: "user-1",
        organizationId: "org-1",
        isRemoving: false,
      });

      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-1",
          type: "UPDATE",
          organizationId: "org-1",
        })
      );
    });
  });

  describe("updateLocationAssets", () => {
    it("records notes when assets are assigned", async () => {
      dbMocks.asset.findMany.mockResolvedValueOnce([
        {
          id: "asset-1",
          title: "Camera",
          type: "INDIVIDUAL",
          quantity: 1,
          // `getPrimaryLocation` reads `assetLocations[0].location` from
          // the pivot to derive prior placement.
          assetLocations: [{ location: { id: "loc-3", name: "Warehouse" } }],
          user: { id: "user-1", firstName: "Ada", lastName: "Lovelace" },
        },
      ]);

      await updateLocationAssets({
        assetIds: ["asset-1"],
        organizationId: "org-1",
        locationId: "loc-1",
        userId: "user-1",
        request: new Request("https://example.com"),
        removedAssetIds: [],
      });

      expect(locationNoteMocks.createSystemLocationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          locationId: "loc-1",
          content: expect.stringContaining("Camera"),
        })
      );
    });
  });

  describe("updateLocationAssets cross-organization guard", () => {
    it("rejects when an assetId does not belong to the caller's organization", async () => {
      // Caller submitted two IDs but only one belongs to the org
      dbMocks.asset.count.mockResolvedValueOnce(1);

      await expect(
        updateLocationAssets({
          assetIds: ["asset-mine", "asset-foreign"],
          organizationId: "org-1",
          locationId: "loc-1",
          userId: "user-1",
          request: new Request("https://example.com"),
          removedAssetIds: [],
        })
      ).rejects.toMatchObject({ status: 403 });

      expect(dbMocks.location.update).not.toHaveBeenCalled();
    });

    it("rejects when a removedAssetId does not belong to the caller's organization", async () => {
      dbMocks.asset.count.mockResolvedValueOnce(0);

      await expect(
        updateLocationAssets({
          assetIds: [],
          organizationId: "org-1",
          locationId: "loc-1",
          userId: "user-1",
          request: new Request("https://example.com"),
          removedAssetIds: ["asset-foreign"],
        })
      ).rejects.toMatchObject({ status: 403 });

      expect(dbMocks.location.update).not.toHaveBeenCalled();
    });

    it("rejects when ALL_SELECTED expansion is paired with a foreign removedAssetId", async () => {
      // ALL_SELECTED expansion still funnels through the assertion which
      // checks both arrays. The foreign ID in removedAssetIds must trip 403.
      dbMocks.asset.findMany.mockResolvedValueOnce([{ id: "asset-mine" }]);
      // count over { asset-mine, asset-foreign } returns 1 (foreign missing)
      dbMocks.asset.count.mockResolvedValueOnce(1);

      await expect(
        updateLocationAssets({
          assetIds: ["__ALL__"],
          organizationId: "org-1",
          locationId: "loc-1",
          userId: "user-1",
          request: new Request("https://example.com"),
          removedAssetIds: ["asset-foreign"],
        })
      ).rejects.toMatchObject({ status: 403 });

      expect(dbMocks.location.update).not.toHaveBeenCalled();
    });

    it("skips the count query when no IDs are submitted", async () => {
      await updateLocationAssets({
        assetIds: [],
        organizationId: "org-1",
        locationId: "loc-1",
        userId: "user-1",
        request: new Request("https://example.com"),
        removedAssetIds: [],
      });

      expect(dbMocks.asset.count).not.toHaveBeenCalled();
    });
  });

  describe("updateLocationAssets quantity allocation", () => {
    /**
     * Builds the modifiedAssets fetch result. The orthogonal-MAX
     * validator reads `type`, `quantity`, and the full `assetLocations`
     * (locationId + quantity) per row to compute
     * `Asset.quantity − sum(other locations)`.
     */
    function modifiedAssetRow(overrides: {
      id: string;
      type: "INDIVIDUAL" | "QUANTITY_TRACKED";
      quantity: number;
      assetLocations?: Array<{
        locationId: string;
        quantity: number;
        location: { id: string; name: string };
      }>;
    }) {
      return {
        id: overrides.id,
        title: `Asset ${overrides.id}`,
        type: overrides.type,
        quantity: overrides.quantity,
        assetLocations: overrides.assetLocations ?? [],
        user: { id: "user-1", firstName: "Ada", lastName: "Lovelace" },
      };
    }

    it("falls back to Asset.quantity when assetQuantities is omitted (back-compat)", async () => {
      dbMocks.asset.findMany.mockResolvedValueOnce([
        modifiedAssetRow({
          id: "pens",
          type: "QUANTITY_TRACKED",
          quantity: 80,
        }),
      ]);

      await updateLocationAssets({
        assetIds: ["pens"],
        organizationId: "org-1",
        locationId: "loc-1",
        userId: "user-1",
        request: new Request("https://example.com"),
        removedAssetIds: [],
      });

      expect(dbMocks.assetLocation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ assetId: "pens", quantity: 80 })],
        })
      );
    });

    it("writes the submitted qty for QUANTITY_TRACKED assets", async () => {
      dbMocks.asset.findMany.mockResolvedValueOnce([
        modifiedAssetRow({
          id: "pens",
          type: "QUANTITY_TRACKED",
          quantity: 80,
        }),
      ]);

      await updateLocationAssets({
        assetIds: ["pens"],
        organizationId: "org-1",
        locationId: "loc-1",
        userId: "user-1",
        request: new Request("https://example.com"),
        removedAssetIds: [],
        assetQuantities: { pens: 30 },
      });

      expect(dbMocks.assetLocation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ assetId: "pens", quantity: 30 })],
        })
      );
    });

    it("forces INDIVIDUAL qty to 1 even when assetQuantities tries to set it higher", async () => {
      dbMocks.asset.findMany.mockResolvedValueOnce([
        modifiedAssetRow({
          id: "camera",
          type: "INDIVIDUAL",
          quantity: 1,
        }),
      ]);

      await updateLocationAssets({
        assetIds: ["camera"],
        organizationId: "org-1",
        locationId: "loc-1",
        userId: "user-1",
        request: new Request("https://example.com"),
        removedAssetIds: [],
        // INDIVIDUAL never honours a submitted qty (no input renders for them).
        assetQuantities: { camera: 5 },
      });

      expect(dbMocks.assetLocation.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({ assetId: "camera", quantity: 1 })],
        })
      );
    });

    it("rejects with 400 when submitted qty exceeds orthogonal MAX", async () => {
      // Pens 80 total, 50 already at Warehouse (loc-2). Submitting 60
      // at loc-1 would push the sum to 110 → reject. spaceWithoutMe is
      // 80 − 50 = 30; max = max(0, 30) = 30; submitted 60 > 30.
      dbMocks.asset.findMany.mockResolvedValueOnce([
        modifiedAssetRow({
          id: "pens",
          type: "QUANTITY_TRACKED",
          quantity: 80,
          assetLocations: [
            {
              locationId: "loc-2",
              quantity: 50,
              location: { id: "loc-2", name: "Warehouse" },
            },
          ],
        }),
      ]);

      await expect(
        updateLocationAssets({
          assetIds: ["pens"],
          organizationId: "org-1",
          locationId: "loc-1",
          userId: "user-1",
          request: new Request("https://example.com"),
          removedAssetIds: [],
          assetQuantities: { pens: 60 },
        })
      ).rejects.toMatchObject({
        status: 400,
        title: "Quantity exceeds available pool",
      });

      // Validation runs before the tx → no pivot row written.
      expect(dbMocks.assetLocation.createMany).not.toHaveBeenCalled();
    });

    it("allows submitting the current slice when over-committed (max = currentAtThisLocation)", async () => {
      // Pathological state: 60 already at loc-1 + 50 at loc-2 = 110, but
      // Asset.quantity is only 80. spaceWithoutMe = 80 − 50 = 30; max =
      // max(60, 30) = 60. Submitting 60 should pass.
      dbMocks.location.findUniqueOrThrow.mockResolvedValueOnce({
        id: "loc-1",
        organizationId: "org-1",
        address: "Old St",
        latitude: null,
        longitude: null,
        // Pens is already at loc-1 with qty 60.
        assetLocations: [{ assetId: "pens", quantity: 60 }],
        kits: [],
      });
      dbMocks.asset.findMany.mockResolvedValueOnce([
        modifiedAssetRow({
          id: "pens",
          type: "QUANTITY_TRACKED",
          quantity: 80,
          assetLocations: [
            {
              locationId: "loc-1",
              quantity: 60,
              location: { id: "loc-1", name: "Office" },
            },
            {
              locationId: "loc-2",
              quantity: 50,
              location: { id: "loc-2", name: "Warehouse" },
            },
          ],
        }),
      ]);

      await updateLocationAssets({
        assetIds: ["pens"],
        organizationId: "org-1",
        locationId: "loc-1",
        userId: "user-1",
        request: new Request("https://example.com"),
        removedAssetIds: [],
        // Keep the existing 60-unit slice — qty edit is a no-op here
        // (60 === 60) so it doesn't trip the qty-edit branch.
        assetQuantities: { pens: 60 },
      });

      // No 400 thrown; the asset wasn't in actuallyNewAssetIds (it was
      // already at loc-1) and the submitted qty matches the existing
      // pivot row, so the qty-edit branch is also skipped.
      expect(dbMocks.assetLocation.update).not.toHaveBeenCalled();
    });

    it("updates the existing pivot row when submitted qty differs from current", async () => {
      // Pens already at loc-1 with qty 30; user picks the picker open
      // and changes to 50. Asset has no other placements so MAX = 80.
      dbMocks.location.findUniqueOrThrow.mockResolvedValueOnce({
        id: "loc-1",
        organizationId: "org-1",
        address: null,
        latitude: null,
        longitude: null,
        assetLocations: [{ assetId: "pens", quantity: 30 }],
        kits: [],
      });
      dbMocks.asset.findMany.mockResolvedValueOnce([
        modifiedAssetRow({
          id: "pens",
          type: "QUANTITY_TRACKED",
          quantity: 80,
          assetLocations: [
            {
              locationId: "loc-1",
              quantity: 30,
              location: { id: "loc-1", name: "Office" },
            },
          ],
        }),
      ]);

      await updateLocationAssets({
        assetIds: ["pens"],
        organizationId: "org-1",
        locationId: "loc-1",
        userId: "user-1",
        request: new Request("https://example.com"),
        removedAssetIds: [],
        assetQuantities: { pens: 50 },
      });

      // The qty-edit branch uses `updateMany` scoped to
      // `assetKitId: null` because the (assetId, locationId) composite
      // isn't unique when manual + kit-driven rows can coexist. The
      // partial unique `AssetLocation_manual_unique` still caps it at
      // one match.
      expect(dbMocks.assetLocation.updateMany).toHaveBeenCalledWith({
        where: { assetId: "pens", locationId: "loc-1", assetKitId: null },
        data: { quantity: 50 },
      });
      // No createMany because the asset is already at this location.
      expect(dbMocks.assetLocation.createMany).not.toHaveBeenCalled();
    });
  });

  describe("updateLocationKits", () => {
    it("records notes when kits are assigned", async () => {
      dbMocks.location.findUniqueOrThrow.mockResolvedValueOnce({
        id: "loc-1",
        organizationId: "org-1",
        kits: [],
      });

      dbMocks.location.update.mockResolvedValueOnce({ id: "loc-1" });

      const kitAssets = [
        {
          id: "asset-1",
          title: "Lens",
          location: { id: "loc-9", name: "Main" },
        },
      ];

      // Phase-4a: Kit now exposes assets through the AssetKit pivot
      const kitRecords = [
        {
          id: "kit-1",
          name: "Shoot Kit",
          assetKits: kitAssets.map((asset) => ({ asset })),
        },
      ];

      dbMocks.kit.findMany
        .mockResolvedValueOnce(kitRecords)
        .mockResolvedValueOnce(kitRecords);

      await updateLocationKits({
        locationId: "loc-1",
        kitIds: ["kit-1"],
        removedKitIds: [],
        organizationId: "org-1",
        userId: "user-1",
        request: new Request("https://example.com"),
      });

      expect(locationNoteMocks.createSystemLocationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          locationId: "loc-1",
          content: expect.stringContaining("Shoot Kit"),
        })
      );
    });
  });

  describe("updateLocationKits cross-organization guard", () => {
    it("rejects when a kitId does not belong to the caller's organization", async () => {
      dbMocks.kit.count.mockResolvedValueOnce(1);

      await expect(
        updateLocationKits({
          locationId: "loc-1",
          kitIds: ["kit-mine", "kit-foreign"],
          removedKitIds: [],
          organizationId: "org-1",
          userId: "user-1",
          request: new Request("https://example.com"),
        })
      ).rejects.toMatchObject({ status: 403 });

      expect(dbMocks.location.update).not.toHaveBeenCalled();
    });

    it("rejects when a removedKitId does not belong to the caller's organization", async () => {
      dbMocks.kit.count.mockResolvedValueOnce(0);

      await expect(
        updateLocationKits({
          locationId: "loc-1",
          kitIds: [],
          removedKitIds: ["kit-foreign"],
          organizationId: "org-1",
          userId: "user-1",
          request: new Request("https://example.com"),
        })
      ).rejects.toMatchObject({ status: 403 });

      expect(dbMocks.location.update).not.toHaveBeenCalled();
    });

    it("skips the count query when no kit IDs are submitted", async () => {
      await updateLocationKits({
        locationId: "loc-1",
        kitIds: [],
        removedKitIds: [],
        organizationId: "org-1",
        userId: "user-1",
        request: new Request("https://example.com"),
      });

      expect(dbMocks.kit.count).not.toHaveBeenCalled();
    });
  });
});
