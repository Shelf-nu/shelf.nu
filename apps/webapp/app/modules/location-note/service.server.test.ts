import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import {
  create,
  deleteMany,
  findFirst,
  findMany,
} from "~/database/query-helpers.server";

import {
  createLocationNote,
  createSystemLocationNote,
  deleteLocationNote,
  getLocationNotes,
} from "./service.server";

// why: testing location note service logic without touching the real database
vi.mock("~/database/db.server", () => ({
  db: {},
}));

// why: We need to mock database query helpers to avoid hitting the real database during tests
vi.mock("~/database/query-helpers.server");

// why: testing error handling behavior without depending on ShelfError implementation
vi.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(config: any) {
      super(config.message);
      Object.assign(this, config);
    }
  },
}));

describe("location note service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createLocationNote", () => {
    it("creates a note associated to the user and location", async () => {
      const note = {
        id: "lnote-1",
        content: "Manual note",
        type: "COMMENT",
        locationId: "loc-1",
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      vi.mocked(create).mockResolvedValue(note);

      const result = await createLocationNote({
        content: "Manual note",
        locationId: "loc-1",
        userId: "user-1",
        type: "COMMENT",
      });

      expect(create).toHaveBeenCalledWith(db, "LocationNote", {
        content: "Manual note",
        type: "COMMENT",
        locationId: "loc-1",
        userId: "user-1",
      });
      expect(result).toEqual(note);
    });

    it("allows creating a system note without a user", async () => {
      const note = {
        id: "lnote-2",
        content: "System note",
        type: "UPDATE",
        locationId: "loc-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      vi.mocked(create).mockResolvedValue(note);

      const result = await createLocationNote({
        content: "System note",
        locationId: "loc-1",
        type: "UPDATE",
      });

      expect(create).toHaveBeenCalledWith(db, "LocationNote", {
        content: "System note",
        type: "UPDATE",
        locationId: "loc-1",
      });
      expect(result).toEqual(note);
    });
  });

  describe("createSystemLocationNote", () => {
    it("forces UPDATE type and omits user linkage", async () => {
      const note = {
        id: "lnote-3",
        content: "Profile updated",
        type: "UPDATE",
        locationId: "loc-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      vi.mocked(create).mockResolvedValue(note);

      const result = await createSystemLocationNote({
        content: "Profile updated",
        locationId: "loc-1",
      });

      expect(create).toHaveBeenCalledWith(db, "LocationNote", {
        content: "Profile updated",
        type: "UPDATE",
        locationId: "loc-1",
      });
      expect(result).toEqual(note);
    });
  });

  describe("getLocationNotes", () => {
    it("returns notes when location belongs to organization", async () => {
      const notes = [
        {
          id: "lnote-1",
          content: "Manual",
          type: "COMMENT" as const,
          locationId: "loc-1",
          userId: "user-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { firstName: "Jane", lastName: "Doe" },
        },
      ];

      vi.mocked(findFirst).mockResolvedValue({ id: "loc-1" } as any);
      vi.mocked(findMany).mockResolvedValue(notes);

      const result = await getLocationNotes({
        locationId: "loc-1",
        organizationId: "org-1",
      });

      expect(findFirst).toHaveBeenCalledWith(db, "Location", {
        where: { id: "loc-1", organizationId: "org-1" },
        select: "id",
      });

      expect(findMany).toHaveBeenCalledWith(db, "LocationNote", {
        where: { locationId: "loc-1" },
        orderBy: { createdAt: "desc" },
        select: "*, user:User(firstName, lastName)",
      });

      expect(result).toEqual(notes);
    });

    it("throws when location does not belong to organization", async () => {
      vi.mocked(findFirst).mockResolvedValue(null);

      await expect(
        getLocationNotes({ locationId: "loc-2", organizationId: "org-9" })
      ).rejects.toThrow("Location not found or access denied");
    });
  });

  describe("deleteLocationNote", () => {
    it("only deletes notes authored by the user", async () => {
      vi.mocked(deleteMany).mockResolvedValue({ count: 1 });

      const result = await deleteLocationNote({
        id: "lnote-1",
        userId: "user-1",
      });

      expect(deleteMany).toHaveBeenCalledWith(db, "LocationNote", {
        id: "lnote-1",
        userId: "user-1",
      });
      expect(result).toEqual({ count: 1 });
    });
  });
});
