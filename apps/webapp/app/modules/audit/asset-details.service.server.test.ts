import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the database
vi.mock("~/database/db.server", () => ({
  // why: We need to mock database operations to avoid hitting the real database during tests
  db: {
    auditNote: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    auditImage: {
      count: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import {
  createAuditAssetNote,
  deleteAuditAssetNote,
  getAuditAssetDetailsCounts,
  getAuditAssetNotes,
  updateAuditAssetNote,
} from "./asset-details.service.server";

describe("audit asset details service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAuditAssetNote", () => {
    it("successfully creates a note for an audit asset", async () => {
      const mockNote = {
        id: "note-1",
        content: "This asset needs maintenance",
        type: "COMMENT",
        userId: "user-1",
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: "user-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          profilePicture: null,
        },
      };

      vi.mocked(db.auditNote.create).mockResolvedValue(mockNote as any);

      const result = await createAuditAssetNote({
        content: "This asset needs maintenance",
        userId: "user-1",
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(db.auditNote.create).toHaveBeenCalledWith({
        data: {
          content: "This asset needs maintenance",
          type: "COMMENT",
          userId: "user-1",
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePicture: true,
            },
          },
        },
      });

      expect(result).toEqual(mockNote);
      expect(result.user?.firstName).toBe("John");
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.auditNote.create).mockRejectedValue(
        new Error("Database connection failed")
      );

      await expect(
        createAuditAssetNote({
          content: "Test note",
          userId: "user-1",
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        createAuditAssetNote({
          content: "Test note",
          userId: "user-1",
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        })
      ).rejects.toThrow("Failed to create asset note");
    });
  });

  describe("updateAuditAssetNote", () => {
    it("successfully updates a note owned by the user", async () => {
      const existingNote = {
        id: "note-1",
        content: "Original content",
        type: "COMMENT",
        userId: "user-1",
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedNote = {
        ...existingNote,
        content: "Updated content",
        user: {
          id: "user-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          profilePicture: null,
        },
      };

      vi.mocked(db.auditNote.findFirst).mockResolvedValue(existingNote as any);
      vi.mocked(db.auditNote.update).mockResolvedValue(updatedNote as any);

      const result = await updateAuditAssetNote({
        noteId: "note-1",
        content: "Updated content",
        userId: "user-1",
      });

      expect(db.auditNote.findFirst).toHaveBeenCalledWith({
        where: {
          id: "note-1",
          userId: "user-1",
          auditAssetId: { not: null },
        },
      });

      expect(db.auditNote.update).toHaveBeenCalledWith({
        where: { id: "note-1" },
        data: { content: "Updated content" },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePicture: true,
            },
          },
        },
      });

      expect(result.content).toBe("Updated content");
    });

    it("throws 404 error when note is not found", async () => {
      vi.mocked(db.auditNote.findFirst).mockResolvedValue(null);

      await expect(
        updateAuditAssetNote({
          noteId: "nonexistent-note",
          content: "Updated content",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);

      expect(db.auditNote.update).not.toHaveBeenCalled();
    });

    it("throws 404 error when user doesn't own the note", async () => {
      // findFirst returns null because userId doesn't match
      vi.mocked(db.auditNote.findFirst).mockResolvedValue(null);

      await expect(
        updateAuditAssetNote({
          noteId: "note-1",
          content: "Updated content",
          userId: "wrong-user",
        })
      ).rejects.toThrow(ShelfError);

      expect(db.auditNote.update).not.toHaveBeenCalled();
    });

    it("only allows updating asset-specific notes (auditAssetId not null)", async () => {
      // Verify the where clause includes auditAssetId: { not: null }
      vi.mocked(db.auditNote.findFirst).mockResolvedValue(null);

      await expect(
        updateAuditAssetNote({
          noteId: "note-1",
          content: "Updated content",
          userId: "user-1",
        })
      ).rejects.toThrow();

      expect(db.auditNote.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            auditAssetId: { not: null },
          }),
        })
      );
    });
  });

  describe("deleteAuditAssetNote", () => {
    it("successfully deletes a note owned by the user", async () => {
      const existingNote = {
        id: "note-1",
        content: "Note to delete",
        type: "COMMENT",
        userId: "user-1",
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(db.auditNote.findFirst).mockResolvedValue(existingNote as any);
      vi.mocked(db.auditNote.delete).mockResolvedValue(existingNote as any);

      const result = await deleteAuditAssetNote({
        noteId: "note-1",
        userId: "user-1",
      });

      expect(db.auditNote.findFirst).toHaveBeenCalledWith({
        where: {
          id: "note-1",
          userId: "user-1",
          auditAssetId: { not: null },
        },
      });

      expect(db.auditNote.delete).toHaveBeenCalledWith({
        where: { id: "note-1" },
      });

      expect(result).toEqual(existingNote);
    });

    it("throws 404 error when note is not found", async () => {
      vi.mocked(db.auditNote.findFirst).mockResolvedValue(null);

      await expect(
        deleteAuditAssetNote({
          noteId: "nonexistent-note",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);

      expect(db.auditNote.delete).not.toHaveBeenCalled();
    });

    it("throws 404 error when user doesn't own the note", async () => {
      vi.mocked(db.auditNote.findFirst).mockResolvedValue(null);

      await expect(
        deleteAuditAssetNote({
          noteId: "note-1",
          userId: "wrong-user",
        })
      ).rejects.toThrow(ShelfError);

      expect(db.auditNote.delete).not.toHaveBeenCalled();
    });
  });

  describe("getAuditAssetNotes", () => {
    it("fetches notes for a specific audit asset ordered by newest first", async () => {
      const mockNotes = [
        {
          id: "note-2",
          content: "Most recent note",
          type: "COMMENT",
          userId: "user-1",
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          user: {
            id: "user-1",
            firstName: "John",
            lastName: "Doe",
            email: "john@example.com",
            profilePicture: null,
          },
        },
        {
          id: "note-1",
          content: "Older note",
          type: "COMMENT",
          userId: "user-2",
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          user: {
            id: "user-2",
            firstName: "Jane",
            lastName: "Smith",
            email: "jane@example.com",
            profilePicture: null,
          },
        },
      ];

      vi.mocked(db.auditNote.findMany).mockResolvedValue(mockNotes as any);

      const result = await getAuditAssetNotes({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(db.auditNote.findMany).toHaveBeenCalledWith({
        where: {
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePicture: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("Most recent note");
      expect(result[1].content).toBe("Older note");
    });

    it("returns empty array when no notes exist", async () => {
      vi.mocked(db.auditNote.findMany).mockResolvedValue([]);

      const result = await getAuditAssetNotes({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(result).toEqual([]);
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.auditNote.findMany).mockRejectedValue(
        new Error("Database timeout")
      );

      await expect(
        getAuditAssetNotes({
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        getAuditAssetNotes({
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        })
      ).rejects.toThrow("Failed to fetch asset notes");
    });
  });

  describe("getAuditAssetDetailsCounts", () => {
    it("returns counts of notes and images for an audit asset", async () => {
      vi.mocked(db.auditNote.count).mockResolvedValue(3);
      vi.mocked(db.auditImage.count).mockResolvedValue(2);

      const result = await getAuditAssetDetailsCounts({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(db.auditNote.count).toHaveBeenCalledWith({
        where: {
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        },
      });

      expect(db.auditImage.count).toHaveBeenCalledWith({
        where: {
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        },
      });

      expect(result).toEqual({
        notesCount: 3,
        imagesCount: 2,
      });
    });

    it("returns zero counts when no notes or images exist", async () => {
      vi.mocked(db.auditNote.count).mockResolvedValue(0);
      vi.mocked(db.auditImage.count).mockResolvedValue(0);

      const result = await getAuditAssetDetailsCounts({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(result).toEqual({
        notesCount: 0,
        imagesCount: 0,
      });
    });

    it("executes both count queries in parallel", async () => {
      // Mock both counts to resolve after a delay to verify parallel execution
      vi.mocked(db.auditNote.count).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(5), 10);
          })
      );
      vi.mocked(db.auditImage.count).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(3), 10);
          })
      );

      const startTime = Date.now();
      await getAuditAssetDetailsCounts({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });
      const duration = Date.now() - startTime;

      // If queries ran sequentially, it would take ~20ms
      // If parallel (using Promise.all), should be ~10ms
      expect(duration).toBeLessThan(20);
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(db.auditNote.count).mockRejectedValue(
        new Error("Database error")
      );

      await expect(
        getAuditAssetDetailsCounts({
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        getAuditAssetDetailsCounts({
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        })
      ).rejects.toThrow("Failed to fetch asset details counts");
    });
  });
});
