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
});
