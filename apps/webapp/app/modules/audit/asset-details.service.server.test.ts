import { beforeEach, describe, expect, it, vi } from "vitest";

// why: Stub the db export so imports resolve; actual queries go through query helpers
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: Auto-mock query helpers so we can control return values per test
vi.mock("~/database/query-helpers.server");

import {
  create,
  findFirst,
  findMany,
  update,
  remove as removeRecord,
  count,
} from "~/database/query-helpers.server";
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
      };

      const mockUser = {
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        profilePicture: null,
      };

      vi.mocked(create).mockResolvedValue(mockNote as any);
      vi.mocked(findFirst).mockResolvedValue(mockUser as any);

      const result = await createAuditAssetNote({
        content: "This asset needs maintenance",
        userId: "user-1",
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(vi.mocked(create)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
        {
          content: "This asset needs maintenance",
          type: "COMMENT",
          userId: "user-1",
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        }
      );

      expect(vi.mocked(findFirst)).toHaveBeenCalledWith(
        expect.anything(),
        "User",
        {
          where: { id: "user-1" },
          select: "id, firstName, lastName, email, profilePicture",
        }
      );

      expect(result).toEqual({ ...mockNote, user: mockUser });
      expect(result.user?.firstName).toBe("John");
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(create).mockRejectedValue(
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
      };

      const mockUser = {
        id: "user-1",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        profilePicture: null,
      };

      // First findFirst: check note exists and user owns it
      // Second findFirst: fetch the user for the response
      vi.mocked(findFirst)
        .mockResolvedValueOnce(existingNote as any)
        .mockResolvedValueOnce(mockUser as any);
      vi.mocked(update).mockResolvedValue(updatedNote as any);

      const result = await updateAuditAssetNote({
        noteId: "note-1",
        content: "Updated content",
        userId: "user-1",
      });

      expect(vi.mocked(findFirst)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
        {
          where: {
            id: "note-1",
            userId: "user-1",
            auditAssetId: { not: null },
          },
        }
      );

      expect(vi.mocked(update)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
        {
          where: { id: "note-1" },
          data: { content: "Updated content" },
        }
      );

      expect(result.content).toBe("Updated content");
    });

    it("throws 404 error when note is not found", async () => {
      vi.mocked(findFirst).mockResolvedValue(null as any);

      await expect(
        updateAuditAssetNote({
          noteId: "nonexistent-note",
          content: "Updated content",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);

      expect(vi.mocked(update)).not.toHaveBeenCalled();
    });

    it("throws 404 error when user doesn't own the note", async () => {
      // findFirst returns null because userId doesn't match
      vi.mocked(findFirst).mockResolvedValue(null as any);

      await expect(
        updateAuditAssetNote({
          noteId: "note-1",
          content: "Updated content",
          userId: "wrong-user",
        })
      ).rejects.toThrow(ShelfError);

      expect(vi.mocked(update)).not.toHaveBeenCalled();
    });

    it("only allows updating asset-specific notes (auditAssetId not null)", async () => {
      // Verify the where clause includes auditAssetId: { not: null }
      vi.mocked(findFirst).mockResolvedValue(null as any);

      await expect(
        updateAuditAssetNote({
          noteId: "note-1",
          content: "Updated content",
          userId: "user-1",
        })
      ).rejects.toThrow();

      expect(vi.mocked(findFirst)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
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

      vi.mocked(findFirst).mockResolvedValue(existingNote as any);
      vi.mocked(removeRecord).mockResolvedValue([existingNote] as any);

      const result = await deleteAuditAssetNote({
        noteId: "note-1",
        userId: "user-1",
      });

      expect(vi.mocked(findFirst)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
        {
          where: {
            id: "note-1",
            userId: "user-1",
            auditAssetId: { not: null },
          },
        }
      );

      expect(vi.mocked(removeRecord)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
        { id: "note-1" }
      );

      expect(result).toEqual(existingNote);
    });

    it("throws 404 error when note is not found", async () => {
      vi.mocked(findFirst).mockResolvedValue(null as any);

      await expect(
        deleteAuditAssetNote({
          noteId: "nonexistent-note",
          userId: "user-1",
        })
      ).rejects.toThrow(ShelfError);

      expect(vi.mocked(removeRecord)).not.toHaveBeenCalled();
    });

    it("throws 404 error when user doesn't own the note", async () => {
      vi.mocked(findFirst).mockResolvedValue(null as any);

      await expect(
        deleteAuditAssetNote({
          noteId: "note-1",
          userId: "wrong-user",
        })
      ).rejects.toThrow(ShelfError);

      expect(vi.mocked(removeRecord)).not.toHaveBeenCalled();
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
        },
      ];

      const mockUsers = [
        {
          id: "user-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          profilePicture: null,
        },
        {
          id: "user-2",
          firstName: "Jane",
          lastName: "Smith",
          email: "jane@example.com",
          profilePicture: null,
        },
      ];

      vi.mocked(findMany).mockImplementation((_db, table, _opts?) => {
        if (table === "AuditNote") {
          return Promise.resolve(mockNotes as any);
        }
        if (table === "User") {
          return Promise.resolve(mockUsers as any);
        }
        return Promise.resolve([]);
      });

      const result = await getAuditAssetNotes({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(vi.mocked(findMany)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
        {
          where: {
            auditSessionId: "audit-1",
            auditAssetId: "audit-asset-1",
          },
          orderBy: {
            createdAt: "desc",
          },
        }
      );

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("Most recent note");
      expect(result[1].content).toBe("Older note");
    });

    it("returns empty array when no notes exist", async () => {
      vi.mocked(findMany).mockResolvedValue([]);

      const result = await getAuditAssetNotes({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(result).toEqual([]);
    });

    it("throws ShelfError when database operation fails", async () => {
      vi.mocked(findMany).mockRejectedValue(new Error("Database timeout"));

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
      vi.mocked(count).mockImplementation((_db, table, _where?) => {
        if (table === "AuditNote") return Promise.resolve(3);
        if (table === "AuditImage") return Promise.resolve(2);
        return Promise.resolve(0);
      });

      const result = await getAuditAssetDetailsCounts({
        auditSessionId: "audit-1",
        auditAssetId: "audit-asset-1",
      });

      expect(vi.mocked(count)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditNote",
        {
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        }
      );

      expect(vi.mocked(count)).toHaveBeenCalledWith(
        expect.anything(),
        "AuditImage",
        {
          auditSessionId: "audit-1",
          auditAssetId: "audit-asset-1",
        }
      );

      expect(result).toEqual({
        notesCount: 3,
        imagesCount: 2,
      });
    });

    it("returns zero counts when no notes or images exist", async () => {
      vi.mocked(count).mockResolvedValue(0);

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
      vi.mocked(count).mockImplementation(
        (_db, _table, _where?) =>
          new Promise((resolve) => {
            setTimeout(() => resolve(5), 10);
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
      vi.mocked(count).mockRejectedValue(new Error("Database error"));

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
