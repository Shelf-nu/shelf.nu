import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

import {
  createPreset,
  deletePreset,
  listPresetsForUser,
  listPresetsWithShared,
  renamePreset,
  setPresetShared,
} from "./service.server";

// @vitest-environment node

const mockPreset = {
  id: "preset-1",
  organizationId: "org-1",
  ownerId: "user-1",
  name: "My preset",
  query: "status=AVAILABLE",
  starred: false,
  shared: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** A preset another member of the workspace published. */
const sharedByOther = {
  ...mockPreset,
  id: "preset-2",
  ownerId: "user-2",
  name: "Regional stock",
  shared: true,
  owner: { firstName: "Ada", lastName: "Byron", displayName: null },
};

type MockDb = {
  $transaction: <T>(callback: (tx: MockDb) => Promise<T>) => Promise<T>;
  assetFilterPreset: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};

const dbMock = vi.hoisted<MockDb>(() => ({
  $transaction: vi.fn(
    <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> =>
      callback(dbMock as MockDb)
  ) as <T>(callback: (tx: MockDb) => Promise<T>) => Promise<T>,
  assetFilterPreset: {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// why: isolating database calls for unit testing the service logic
vi.mock("~/database/db.server", () => ({
  db: dbMock,
}));

describe("asset-filter-presets service", () => {
  beforeEach(() => {
    // Reset the transaction mock to re-execute callbacks
    (dbMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      <T>(callback: (tx: MockDb) => Promise<T>): Promise<T> => callback(dbMock)
    );

    Object.values(dbMock.assetFilterPreset).forEach((mock) => {
      (mock as ReturnType<typeof vi.fn>).mockReset();
    });
  });

  describe("listPresetsForUser", () => {
    it("lists the user's own presets ordered by name", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([mockPreset]);

      const presets = await listPresetsForUser({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(dbMock.assetFilterPreset.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", ownerId: "user-1" },
        orderBy: [{ starred: "desc" }, { name: "asc" }],
      });
      expect(presets).toEqual([
        expect.objectContaining({ id: "preset-1", isOwn: true }),
      ]);
    });
  });

  describe("listPresetsWithShared", () => {
    it("reads own presets plus every preset the workspace shared", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([]);

      await listPresetsWithShared({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(dbMock.assetFilterPreset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: "org-1",
            OR: [{ ownerId: "user-1" }, { shared: true }],
          },
        })
      );
    });

    it("marks each row own or shared, and names the owner of a shared one", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([
        {
          ...mockPreset,
          owner: { firstName: "Me", lastName: "", displayName: null },
        },
        sharedByOther,
      ]);

      const presets = await listPresetsWithShared({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(presets).toEqual([
        expect.objectContaining({
          id: "preset-1",
          isOwn: true,
          sharedByName: null,
        }),
        expect.objectContaining({
          id: "preset-2",
          isOwn: false,
          shared: true,
          sharedByName: "Ada Byron",
        }),
      ]);
    });

    it("names a shared owner by their display name when they set one", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([
        {
          ...sharedByOther,
          owner: { firstName: "Ada", lastName: "Byron", displayName: "Ada L." },
        },
      ]);

      const [preset] = await listPresetsWithShared({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(preset.sharedByName).toBe("Ada L.");
    });

    it("orders own starred presets first, then own, then shared", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([
        {
          ...mockPreset,
          owner: { firstName: "Me", lastName: "", displayName: null },
        },
        sharedByOther,
        {
          ...mockPreset,
          id: "preset-3",
          starred: true,
          owner: { firstName: "Me", lastName: "", displayName: null },
        },
      ]);

      const presets = await listPresetsWithShared({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(presets.map((preset) => preset.id)).toEqual([
        "preset-3",
        "preset-1",
        "preset-2",
      ]);
    });
  });

  describe("createPreset", () => {
    it("sanitizes query and trims name before creating a preset", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "  Weekly overview  ",
        query: "page=2&status=AVAILABLE",
      });

      expect(dbMock.assetFilterPreset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "Weekly overview",
          query: "status=AVAILABLE", // page param should be stripped
        }),
      });
    });

    it("counts only the user's own presets against the limit", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Weekly overview",
        query: "status=AVAILABLE",
      });

      // A view someone else shared costs this user no quota.
      expect(dbMock.assetFilterPreset.count).toHaveBeenCalledWith({
        where: { organizationId: "org-1", ownerId: "user-1" },
      });
    });

    it("throws when the per-user limit is reached", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(20);

      await expect(
        createPreset({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "Latest",
          query: "status=AVAILABLE",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("throws when a preset with the same name already exists", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(5);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(mockPreset);

      await expect(
        createPreset({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "My preset",
          query: "status=AVAILABLE",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("only rejects a duplicate name among the user's own presets", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(1);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Regional stock",
        query: "status=AVAILABLE",
      });

      // A personal preset may carry the same name as a shared one: they sit in
      // different groups in the list.
      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          ownerId: "user-1",
          name: "Regional stock",
        },
      });
    });

    it("throws when name is empty", async () => {
      await expect(
        createPreset({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "   ",
          query: "status=AVAILABLE",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });
  });

  describe("renamePreset", () => {
    it("throws when renaming a preset that does not belong to the user", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        renamePreset({
          id: "preset-1",
          organizationId: "org-1",
          ownerId: "user-2",
          name: "New name",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("stays owner-only for a shared preset", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        renamePreset({
          id: "preset-2",
          organizationId: "org-1",
          ownerId: "user-1",
          name: "New name",
        })
      ).rejects.toBeInstanceOf(ShelfError);

      // Sharing never widens the rename: the lookup is still ownership-scoped.
      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: { id: "preset-2", organizationId: "org-1", ownerId: "user-1" },
      });
    });

    it("updates preset name with trimmed value", async () => {
      dbMock.assetFilterPreset.findFirst
        .mockResolvedValueOnce(mockPreset) // ownership check
        .mockResolvedValueOnce(null); // duplicate check
      dbMock.assetFilterPreset.update.mockResolvedValue({
        ...mockPreset,
        name: "Renamed",
      });

      const result = await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "  Renamed  ",
      });

      expect(dbMock.assetFilterPreset.update).toHaveBeenCalledWith({
        where: { id: "preset-1" },
        data: { name: "Renamed" },
      });
      expect(result.name).toBe("Renamed");
    });

    it("returns existing preset when name is unchanged", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(mockPreset);

      const result = await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "My preset",
      });

      expect(dbMock.assetFilterPreset.update).not.toHaveBeenCalled();
      expect(result).toEqual(mockPreset);
    });
  });

  describe("setPresetShared", () => {
    it("shares only a preset the caller owns", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(mockPreset);
      dbMock.assetFilterPreset.update.mockResolvedValue({
        ...mockPreset,
        shared: true,
      });

      await setPresetShared({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        shared: true,
      });

      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: { id: "preset-1", organizationId: "org-1", ownerId: "user-1" },
      });
      expect(dbMock.assetFilterPreset.update).toHaveBeenCalledWith({
        where: { id: "preset-1" },
        data: { shared: true },
      });
    });

    it("refuses to share a preset the caller does not own", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        setPresetShared({
          id: "preset-2",
          organizationId: "org-1",
          ownerId: "user-1",
          shared: true,
        })
      ).rejects.toBeInstanceOf(ShelfError);

      expect(dbMock.assetFilterPreset.update).not.toHaveBeenCalled();
    });

    it("unshares any shared preset in the workspace, not just the caller's", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(sharedByOther);
      dbMock.assetFilterPreset.update.mockResolvedValue({
        ...sharedByOther,
        shared: false,
      });

      await setPresetShared({
        id: "preset-2",
        organizationId: "org-1",
        ownerId: "user-1",
        shared: false,
      });

      // An owner can leave the workspace; their published view must still be
      // retirable by whoever manages the index settings.
      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: {
          id: "preset-2",
          organizationId: "org-1",
          OR: [{ ownerId: "user-1" }, { shared: true }],
        },
      });
      expect(dbMock.assetFilterPreset.update).toHaveBeenCalledWith({
        where: { id: "preset-2" },
        data: { shared: false },
      });
    });
  });

  describe("deletePreset", () => {
    it("deletes a preset owned by the user", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(mockPreset);
      dbMock.assetFilterPreset.delete.mockResolvedValue(mockPreset);

      await deletePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(dbMock.assetFilterPreset.delete).toHaveBeenCalledWith({
        where: { id: "preset-1" },
      });
    });

    it("throws when deleting a preset that does not belong to the user", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        deletePreset({
          id: "preset-1",
          organizationId: "org-1",
          ownerId: "user-2",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("never reaches another member's private preset without the permission", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        deletePreset({
          id: "preset-2",
          organizationId: "org-1",
          ownerId: "user-1",
        })
      ).rejects.toBeInstanceOf(ShelfError);

      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: { id: "preset-2", organizationId: "org-1", ownerId: "user-1" },
      });
    });

    it("deletes another member's SHARED preset for a user who may manage them", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(sharedByOther);
      dbMock.assetFilterPreset.delete.mockResolvedValue(sharedByOther);

      await deletePreset({
        id: "preset-2",
        organizationId: "org-1",
        ownerId: "user-1",
        canManageSharedPresets: true,
      });

      // The widening covers shared presets only — a private one is still
      // matched by ownership alone, so it stays out of reach.
      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: {
          id: "preset-2",
          organizationId: "org-1",
          OR: [{ ownerId: "user-1" }, { shared: true }],
        },
      });
      expect(dbMock.assetFilterPreset.delete).toHaveBeenCalledWith({
        where: { id: "preset-2" },
      });
    });
  });
});
