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

vi.mock("~/database/db.server", () => ({
  db: dbMock,
}));

describe("asset-filter-presets service", () => {
  beforeEach(() => {
    Object.values(dbMock.assetFilterPreset).forEach((mock) => {
      mock.mockReset();
    });
  });

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

  it("sanitizes query before creating a preset", async () => {
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
        query: "status=AVAILABLE",
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

  it("updates preset names with trimmed values", async () => {
    dbMock.assetFilterPreset.findFirst
      .mockResolvedValueOnce(mockPreset)
      .mockResolvedValueOnce(null);
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

  describe("createPreset - additional edge cases", () => {
    it("throws when name is only whitespace", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);

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

    it("throws when name is empty string", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);

      await expect(
        createPreset({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "",
          query: "status=AVAILABLE",
          view: "table",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("throws when duplicate name exists (case-sensitive)", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
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

      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          ownerId: "user-1",
          name: "My preset",
        },
      });
    });

    it("removes page parameter from query", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE&page=5",
        view: "table",
      });

      const createCall = dbMock.assetFilterPreset.create.mock.calls[0][0];
      expect(createCall.data.query).not.toContain("page");
      expect(createCall.data.query).toContain("status=AVAILABLE");
    });

    it("removes scanId parameter from query", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE&scanId=scan-123",
        view: "table",
      });

      const createCall = dbMock.assetFilterPreset.create.mock.calls[0][0];
      expect(createCall.data.query).not.toContain("scanId");
      expect(createCall.data.query).toContain("status=AVAILABLE");
    });

    it("removes redirectTo parameter from query", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE&redirectTo=/assets",
        view: "table",
      });

      const createCall = dbMock.assetFilterPreset.create.mock.calls[0][0];
      expect(createCall.data.query).not.toContain("redirectTo");
      expect(createCall.data.query).toContain("status=AVAILABLE");
    });

    it("removes getAll parameter from query", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE&getAll=true",
        view: "table",
      });

      const createCall = dbMock.assetFilterPreset.create.mock.calls[0][0];
      expect(createCall.data.query).not.toContain("getAll");
      expect(createCall.data.query).toContain("status=AVAILABLE");
    });

    it("removes all excluded parameters from query", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query:
          "status=AVAILABLE&page=2&scanId=abc&redirectTo=/assets&getAll=true&category=tools",
        view: "table",
      });

      const createCall = dbMock.assetFilterPreset.create.mock.calls[0][0];
      const query = createCall.data.query;
      expect(query).not.toContain("page");
      expect(query).not.toContain("scanId");
      expect(query).not.toContain("redirectTo");
      expect(query).not.toContain("getAll");
      expect(query).toContain("status=AVAILABLE");
      expect(query).toContain("category=tools");
    });

    it("defaults to TABLE view when view is undefined", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE",
        view: undefined,
      });

      expect(dbMock.assetFilterPreset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          view: AssetFilterPresetView.TABLE,
        }),
      });
    });

    it("defaults to TABLE view when view is null", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE",
        view: null,
      });

      expect(dbMock.assetFilterPreset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          view: AssetFilterPresetView.TABLE,
        }),
      });
    });

    it("defaults to TABLE view for invalid view string", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE",
        view: "invalid-view",
      });

      expect(dbMock.assetFilterPreset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          view: AssetFilterPresetView.TABLE,
        }),
      });
    });

    it("handles AVAILABILITY view correctly", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Test",
        query: "status=AVAILABLE",
        view: "availability",
      });

      expect(dbMock.assetFilterPreset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          view: AssetFilterPresetView.AVAILABILITY,
        }),
      });
    });

    it("handles empty query string", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Empty filter",
        query: "",
        view: "table",
      });

      expect(dbMock.assetFilterPreset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          query: "",
        }),
      });
    });

    it("preserves complex query parameters", async () => {
      dbMock.assetFilterPreset.count.mockResolvedValue(0);
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);
      dbMock.assetFilterPreset.create.mockResolvedValue(mockPreset);

      const complexQuery =
        "status=AVAILABLE&category=electronics&location=warehouse&customField123=value&search=laptop";

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Complex",
        query: complexQuery,
        view: "table",
      });

      const createCall = dbMock.assetFilterPreset.create.mock.calls[0][0];
      expect(createCall.data.query).toContain("status=AVAILABLE");
      expect(createCall.data.query).toContain("category=electronics");
      expect(createCall.data.query).toContain("location=warehouse");
      expect(createCall.data.query).toContain("customField123=value");
      expect(createCall.data.query).toContain("search=laptop");
    });
  });

  describe("renamePreset - additional edge cases", () => {
    it("returns same preset when new name equals current name", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValueOnce(mockPreset);

      const result = await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "My preset",
      });

      expect(result).toEqual(mockPreset);
      expect(dbMock.assetFilterPreset.update).not.toHaveBeenCalled();
    });

    it("returns same preset when trimmed name equals current name", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValueOnce(mockPreset);

      const result = await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "  My preset  ",
      });

      expect(result).toEqual(mockPreset);
      expect(dbMock.assetFilterPreset.update).not.toHaveBeenCalled();
    });

    it("throws when new name is only whitespace", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValueOnce(mockPreset);

      await expect(
        renamePreset({
          id: "preset-1",
          organizationId: "org-1",
          ownerId: "user-1",
          name: "   ",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("throws when new name is empty", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValueOnce(mockPreset);

      await expect(
        renamePreset({
          id: "preset-1",
          organizationId: "org-1",
          ownerId: "user-1",
          name: "",
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });

    it("throws when duplicate name exists for same user", async () => {
      const duplicatePreset = {
        ...mockPreset,
        id: "preset-2",
        name: "Duplicate",
      };

      dbMock.assetFilterPreset.findFirst
        .mockResolvedValueOnce(mockPreset)
        .mockResolvedValueOnce(duplicatePreset);

      await expect(
        renamePreset({
          id: "preset-1",
          organizationId: "org-1",
          ownerId: "user-1",
          name: "Duplicate",
        })
      ).rejects.toBeInstanceOf(ShelfError);

      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          ownerId: "user-1",
          name: "Duplicate",
          NOT: { id: "preset-1" },
        },
      });
    });

    it("allows rename when no duplicate exists", async () => {
      dbMock.assetFilterPreset.findFirst
        .mockResolvedValueOnce(mockPreset)
        .mockResolvedValueOnce(null);
      dbMock.assetFilterPreset.update.mockResolvedValue({
        ...mockPreset,
        name: "New Name",
      });

      const result = await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "New Name",
      });

      expect(result.name).toBe("New Name");
      expect(dbMock.assetFilterPreset.update).toHaveBeenCalledWith({
        where: { id: "preset-1" },
        data: { name: "New Name" },
      });
    });

    it("handles names with special characters", async () => {
      dbMock.assetFilterPreset.findFirst
        .mockResolvedValueOnce(mockPreset)
        .mockResolvedValueOnce(null);
      dbMock.assetFilterPreset.update.mockResolvedValue({
        ...mockPreset,
        name: "Filter #1 (Updated)",
      });

      await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Filter #1 (Updated)",
      });

      expect(dbMock.assetFilterPreset.update).toHaveBeenCalledWith({
        where: { id: "preset-1" },
        data: { name: "Filter #1 (Updated)" },
      });
    });

    it("handles very long preset names", async () => {
      const longName = "A".repeat(200);
      dbMock.assetFilterPreset.findFirst
        .mockResolvedValueOnce(mockPreset)
        .mockResolvedValueOnce(null);
      dbMock.assetFilterPreset.update.mockResolvedValue({
        ...mockPreset,
        name: longName,
      });

      await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: longName,
      });

      expect(dbMock.assetFilterPreset.update).toHaveBeenCalledWith({
        where: { id: "preset-1" },
        data: { name: longName },
      });
    });
  });

  describe("deletePreset - additional edge cases", () => {
    it("throws when preset does not exist", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        deletePreset({
          id: "nonexistent",
          organizationId: "org-1",
          ownerId: "user-1",
        })
      ).rejects.toBeInstanceOf(ShelfError);

      expect(dbMock.assetFilterPreset.delete).not.toHaveBeenCalled();
    });

    it("throws when preset belongs to different organization", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        deletePreset({
          id: "preset-1",
          organizationId: "org-2",
          ownerId: "user-1",
        })
      ).rejects.toBeInstanceOf(ShelfError);

      expect(dbMock.assetFilterPreset.delete).not.toHaveBeenCalled();
    });

    it("throws when preset belongs to different owner", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(null);

      await expect(
        deletePreset({
          id: "preset-1",
          organizationId: "org-1",
          ownerId: "user-2",
        })
      ).rejects.toBeInstanceOf(ShelfError);

      expect(dbMock.assetFilterPreset.delete).not.toHaveBeenCalled();
    });

    it("successfully deletes when ownership is verified", async () => {
      dbMock.assetFilterPreset.findFirst.mockResolvedValue(mockPreset);
      dbMock.assetFilterPreset.delete.mockResolvedValue(mockPreset);

      await deletePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(dbMock.assetFilterPreset.findFirst).toHaveBeenCalledWith({
        where: {
          id: "preset-1",
          organizationId: "org-1",
          ownerId: "user-1",
        },
      });
      expect(dbMock.assetFilterPreset.delete).toHaveBeenCalledWith({
        where: { id: "preset-1" },
      });
    });
  });

  describe("listPresetsForUser - additional cases", () => {
    it("returns empty array when user has no presets", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([]);

      const result = await listPresetsForUser({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(result).toEqual([]);
    });

    it("returns multiple presets ordered by name", async () => {
      const presets = [
        { ...mockPreset, id: "p1", name: "Alpha" },
        { ...mockPreset, id: "p2", name: "Beta" },
        { ...mockPreset, id: "p3", name: "Gamma" },
      ];
      dbMock.assetFilterPreset.findMany.mockResolvedValue(presets);

      const result = await listPresetsForUser({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Alpha");
      expect(result[1].name).toBe("Beta");
      expect(result[2].name).toBe("Gamma");
    });

    it("filters by both organizationId and ownerId", async () => {
      dbMock.assetFilterPreset.findMany.mockResolvedValue([mockPreset]);

      await listPresetsForUser({
        organizationId: "org-xyz",
        ownerId: "user-abc",
      });

      expect(dbMock.assetFilterPreset.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-xyz", ownerId: "user-abc" },
        orderBy: { name: "asc" },
      });
    });
  });
});