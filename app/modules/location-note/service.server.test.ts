import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLocationNote,
  createSystemLocationNote,
  deleteLocationNote,
  getLocationNotes,
} from "./service.server";

// why: testing location note service logic without touching the real database
vi.mock("~/database/db.server", () => ({
  db: {
    locationNote: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    location: {
      findFirst: vi.fn(),
    },
  },
}));

// why: testing error handling behavior without depending on ShelfError implementation
vi.mock("~/utils/error", () => ({
  ShelfError: class ShelfError extends Error {
    constructor(config: any) {
      super(config.message);
      Object.assign(this, config);
    }
  },
}));

const mockDb = await import("~/database/db.server");

const locationNoteCreateMock = vi.mocked(mockDb.db.locationNote.create);
const locationNoteFindManyMock = vi.mocked(mockDb.db.locationNote.findMany);
const locationNoteDeleteManyMock = vi.mocked(mockDb.db.locationNote.deleteMany);
const locationFindFirstMock = vi.mocked(mockDb.db.location.findFirst);

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

      locationNoteCreateMock.mockResolvedValue(note);

      const result = await createLocationNote({
        content: "Manual note",
        locationId: "loc-1",
        userId: "user-1",
        type: "COMMENT",
      });

      expect(locationNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "Manual note",
          type: "COMMENT",
          location: { connect: { id: "loc-1" } },
          user: { connect: { id: "user-1" } },
        },
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

      locationNoteCreateMock.mockResolvedValue(note);

      const result = await createLocationNote({
        content: "System note",
        locationId: "loc-1",
        type: "UPDATE",
      });

      expect(locationNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "System note",
          type: "UPDATE",
          location: { connect: { id: "loc-1" } },
        },
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

      locationNoteCreateMock.mockResolvedValue(note);

      const result = await createSystemLocationNote({
        content: "Profile updated",
        locationId: "loc-1",
      });

      expect(locationNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "Profile updated",
          type: "UPDATE",
          location: { connect: { id: "loc-1" } },
        },
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

      locationFindFirstMock.mockResolvedValue({ id: "loc-1" } as any);
      locationNoteFindManyMock.mockResolvedValue(notes);

      const result = await getLocationNotes({
        locationId: "loc-1",
        organizationId: "org-1",
      });

      expect(locationFindFirstMock).toHaveBeenCalledWith({
        where: { id: "loc-1", organizationId: "org-1" },
        select: { id: true },
      });

      expect(locationNoteFindManyMock).toHaveBeenCalledWith({
        where: { locationId: "loc-1" },
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      expect(result).toEqual(notes);
    });

    it("throws when location does not belong to organization", async () => {
      locationFindFirstMock.mockResolvedValue(null);

      await expect(
        getLocationNotes({ locationId: "loc-2", organizationId: "org-9" })
      ).rejects.toThrow("Location not found or access denied");
    });
  });

  describe("deleteLocationNote", () => {
    it("only deletes notes authored by the user", async () => {
      locationNoteDeleteManyMock.mockResolvedValue({ count: 1 });

      const result = await deleteLocationNote({
        id: "lnote-1",
        userId: "user-1",
      });

      expect(locationNoteDeleteManyMock).toHaveBeenCalledWith({
        where: { id: "lnote-1", userId: "user-1" },
      });
      expect(result).toEqual({ count: 1 });
    });
  });
});
