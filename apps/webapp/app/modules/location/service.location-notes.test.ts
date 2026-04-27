import { beforeEach, describe, expect, it, vi } from "vitest";

const locationNoteMocks = vi.hoisted(() => ({
  createSystemLocationNote: vi.fn(),
  createLocationNote: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  location: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    findFirstOrThrow: vi.fn(),
  },
  asset: {
    findMany: vi.fn(),
    // why: org-scope assertion in updateLocationAssets calls db.asset.count
    count: vi.fn(),
  },
  kit: {
    findMany: vi.fn(),
    // why: org-scope assertion in updateLocationKits calls db.kit.count
    count: vi.fn(),
  },
  user: {
    findFirstOrThrow: vi.fn(),
    findFirst: vi.fn(),
  },
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
      assets: [],
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
        isRemoving: false,
      });

      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-1",
          type: "UPDATE",
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
          location: { id: "loc-3", name: "Warehouse" },
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

      const kitRecords = [
        { id: "kit-1", name: "Shoot Kit", assets: kitAssets },
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
