import { AssetFilterPresetView } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShelfError } from "~/utils/error";

import {
  createPreset,
  deletePreset,
  listPresetsForUser,
  renamePreset,
} from "./service.server";

// @vitest-environment node

const mockPreset = {
  id: "preset-1",
  organizationId: "org-1",
  ownerId: "user-1",
  name: "My preset",
  query: "status=AVAILABLE",
  view: AssetFilterPresetView.TABLE,
  createdAt: new Date(),
  updatedAt: new Date(),
};

type MockDb = {
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
    Object.values(dbMock.assetFilterPreset).forEach((mock) => {
      mock.mockReset();
    });
  });

  describe("listPresetsForUser", () => {
    it("lists presets ordered by name", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([mockPreset]);

      const presets = await listPresetsForUser({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(dbMock.assetFilterPreset.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", ownerId: "user-1" },
        orderBy: { name: "asc" },
      });
      expect(presets).toEqual([mockPreset]);
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
        view: "availability",
      });

      expect(dbMock.assetFilterPreset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "Weekly overview",
          query: "status=AVAILABLE", // page param should be stripped
          view: AssetFilterPresetView.AVAILABILITY,
        }),
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
          view: "table",
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
          view: "table",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("throws when name is empty", async () => {
      await expect(
        createPreset({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "   ",
          query: "status=AVAILABLE",
          view: "table",
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
  });
});
