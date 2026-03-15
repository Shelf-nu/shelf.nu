import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findMany,
  findFirst,
  count,
  create,
  update,
  remove,
} from "~/database/query-helpers.server";
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
  starred: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// why: stub — the real db is not used directly; query helpers are mocked below
vi.mock("~/database/db.server", () => ({
  db: {},
}));

// why: isolating database calls for unit testing the service logic
vi.mock("~/database/query-helpers.server", () => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const mockedFindMany = vi.mocked(findMany);
const mockedFindFirst = vi.mocked(findFirst);
const mockedCount = vi.mocked(count);
const mockedCreate = vi.mocked(create);
const mockedUpdate = vi.mocked(update);
const mockedRemove = vi.mocked(remove);

describe("asset-filter-presets service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listPresetsForUser", () => {
    it("lists presets ordered by name", async () => {
      //@ts-expect-error mock setup
      mockedFindMany.mockResolvedValue([mockPreset]);

      const presets = await listPresetsForUser({
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(mockedFindMany).toHaveBeenCalledWith(
        expect.anything(), // db
        "AssetFilterPreset",
        {
          where: { organizationId: "org-1", ownerId: "user-1" },
          orderBy: [{ starred: "desc" }, { name: "asc" }],
        }
      );
      expect(presets).toEqual([mockPreset]);
    });
  });

  describe("createPreset", () => {
    it("sanitizes query and trims name before creating a preset", async () => {
      //@ts-expect-error mock setup
      mockedCount.mockResolvedValue(0);
      mockedFindFirst.mockResolvedValue(null);
      //@ts-expect-error mock setup
      mockedCreate.mockResolvedValue(mockPreset);

      await createPreset({
        organizationId: "org-1",
        ownerId: "user-1",
        name: "  Weekly overview  ",
        query: "page=2&status=AVAILABLE",
      });

      expect(mockedCreate).toHaveBeenCalledWith(
        expect.anything(), // db
        "AssetFilterPreset",
        expect.objectContaining({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "Weekly overview",
          query: "status=AVAILABLE", // page param should be stripped
        })
      );
    });

    it("throws when the per-user limit is reached", async () => {
      //@ts-expect-error mock setup
      mockedCount.mockResolvedValue(20);

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
      //@ts-expect-error mock setup
      mockedCount.mockResolvedValue(5);
      //@ts-expect-error mock setup
      mockedFindFirst.mockResolvedValue(mockPreset);

      await expect(
        createPreset({
          organizationId: "org-1",
          ownerId: "user-1",
          name: "My preset",
          query: "status=AVAILABLE",
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
        })
      ).rejects.toBeInstanceOf(ShelfError);
    });
  });

  describe("renamePreset", () => {
    it("throws when renaming a preset that does not belong to the user", async () => {
      mockedFindFirst.mockResolvedValue(null);

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
      mockedFindFirst
        //@ts-expect-error mock setup — ownership check
        .mockResolvedValueOnce(mockPreset)
        .mockResolvedValueOnce(null); // duplicate check
      //@ts-expect-error mock setup
      mockedUpdate.mockResolvedValue({
        ...mockPreset,
        name: "Renamed",
      });

      const result = await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "  Renamed  ",
      });

      expect(mockedUpdate).toHaveBeenCalledWith(
        expect.anything(), // db
        "AssetFilterPreset",
        {
          where: { id: "preset-1" },
          data: { name: "Renamed" },
        }
      );
      expect(result.name).toBe("Renamed");
    });

    it("returns existing preset when name is unchanged", async () => {
      //@ts-expect-error mock setup
      mockedFindFirst.mockResolvedValue(mockPreset);

      const result = await renamePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "My preset",
      });

      expect(mockedUpdate).not.toHaveBeenCalled();
      expect(result).toEqual(mockPreset);
    });
  });

  describe("deletePreset", () => {
    it("deletes a preset owned by the user", async () => {
      //@ts-expect-error mock setup
      mockedFindFirst.mockResolvedValue(mockPreset);
      //@ts-expect-error mock setup
      mockedRemove.mockResolvedValue(mockPreset);

      await deletePreset({
        id: "preset-1",
        organizationId: "org-1",
        ownerId: "user-1",
      });

      expect(mockedRemove).toHaveBeenCalledWith(
        expect.anything(), // db
        "AssetFilterPreset",
        { id: "preset-1" }
      );
    });

    it("throws when deleting a preset that does not belong to the user", async () => {
      mockedFindFirst.mockResolvedValue(null);

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
