import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTeamMemberNote,
  deleteTeamMemberNote,
  getTeamMemberNotes,
} from "./service.server";

// why: testing team member note service logic without touching the real database
vi.mock("~/database/db.server", () => ({
  db: {
    teamMemberNote: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    teamMember: {
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
const { ShelfError } = await import("~/utils/error");

const teamMemberNoteCreateMock = vi.mocked(mockDb.db.teamMemberNote.create);
const teamMemberNoteFindManyMock = vi.mocked(mockDb.db.teamMemberNote.findMany);
const teamMemberNoteDeleteManyMock = vi.mocked(
  mockDb.db.teamMemberNote.deleteMany
);
const teamMemberFindFirstMock = vi.mocked(mockDb.db.teamMember.findFirst);

describe("team member note service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTeamMemberNote", () => {
    it("creates a note with COMMENT type by default, linked to team member and org", async () => {
      const note = {
        id: "tmnote-1",
        content: "Admin note on student",
        type: "COMMENT",
        teamMemberId: "tm-1",
        organizationId: "org-1",
        userId: "admin-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      teamMemberNoteCreateMock.mockResolvedValue(note);

      const result = await createTeamMemberNote({
        content: "Admin note on student",
        teamMemberId: "tm-1",
        organizationId: "org-1",
        userId: "admin-1",
      });

      expect(teamMemberNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "Admin note on student",
          type: "COMMENT",
          teamMember: { connect: { id: "tm-1" } },
          organization: { connect: { id: "org-1" } },
          user: { connect: { id: "admin-1" } },
        },
      });
      expect(result).toEqual(note);
    });

    it("creates a note with UPDATE type when specified", async () => {
      const note = {
        id: "tmnote-2",
        content: "System update",
        type: "UPDATE",
        teamMemberId: "tm-1",
        organizationId: "org-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      teamMemberNoteCreateMock.mockResolvedValue(note);

      await createTeamMemberNote({
        content: "System update",
        type: "UPDATE",
        teamMemberId: "tm-1",
        organizationId: "org-1",
      });

      expect(teamMemberNoteCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "UPDATE",
          }),
        })
      );
    });

    it("allows creating a note without an author (system-generated)", async () => {
      const note = {
        id: "tmnote-3",
        content: "Auto-generated note",
        type: "UPDATE",
        teamMemberId: "tm-1",
        organizationId: "org-1",
        userId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const;

      teamMemberNoteCreateMock.mockResolvedValue(note);

      const result = await createTeamMemberNote({
        content: "Auto-generated note",
        type: "UPDATE",
        teamMemberId: "tm-1",
        organizationId: "org-1",
      });

      /* When no userId is provided, the user connect should not be included */
      expect(teamMemberNoteCreateMock).toHaveBeenCalledWith({
        data: {
          content: "Auto-generated note",
          type: "UPDATE",
          teamMember: { connect: { id: "tm-1" } },
          organization: { connect: { id: "org-1" } },
        },
      });
      expect(result).toEqual(note);
    });

    it("throws ShelfError when database operation fails", async () => {
      teamMemberNoteCreateMock.mockRejectedValue(
        new Error("Database connection failed")
      );

      await expect(
        createTeamMemberNote({
          content: "Test note",
          teamMemberId: "tm-1",
          organizationId: "org-1",
          userId: "admin-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        createTeamMemberNote({
          content: "Test note",
          teamMemberId: "tm-1",
          organizationId: "org-1",
          userId: "admin-1",
        })
      ).rejects.toThrow(
        "Something went wrong while creating the team member note."
      );
    });
  });

  describe("getTeamMemberNotes", () => {
    it("returns notes when team member belongs to organization", async () => {
      const notes = [
        {
          id: "tmnote-1",
          content: "First note",
          type: "COMMENT" as const,
          teamMemberId: "tm-1",
          organizationId: "org-1",
          userId: "admin-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { firstName: "Jane", lastName: "Admin" },
        },
        {
          id: "tmnote-2",
          content: "Second note",
          type: "COMMENT" as const,
          teamMemberId: "tm-1",
          organizationId: "org-1",
          userId: "admin-2",
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { firstName: "John", lastName: "Admin" },
        },
      ];

      teamMemberFindFirstMock.mockResolvedValue({ id: "tm-1" } as any);
      teamMemberNoteFindManyMock.mockResolvedValue(notes);

      const result = await getTeamMemberNotes({
        teamMemberId: "tm-1",
        organizationId: "org-1",
      });

      /* Validates workspace membership via TeamMember lookup */
      expect(teamMemberFindFirstMock).toHaveBeenCalledWith({
        where: { id: "tm-1", organizationId: "org-1", deletedAt: null },
        select: { id: true },
      });

      /* Fetches notes scoped to both teamMember AND organization */
      expect(teamMemberNoteFindManyMock).toHaveBeenCalledWith({
        where: { teamMemberId: "tm-1", organizationId: "org-1" },
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      });

      expect(result).toEqual(notes);
    });

    it("throws 404 when team member does not belong to organization", async () => {
      teamMemberFindFirstMock.mockResolvedValue(null);

      await expect(
        getTeamMemberNotes({
          teamMemberId: "tm-999",
          organizationId: "org-other",
        })
      ).rejects.toThrow("Team member not found in this workspace");

      /* Should never attempt to fetch notes if the team member check fails */
      expect(teamMemberNoteFindManyMock).not.toHaveBeenCalled();
    });

    it("re-throws ShelfError directly without wrapping", async () => {
      teamMemberFindFirstMock.mockResolvedValue(null);

      await expect(
        getTeamMemberNotes({
          teamMemberId: "tm-999",
          organizationId: "org-1",
        })
      ).rejects.toMatchObject({
        status: 404,
        message: "Team member not found in this workspace",
      });
    });

    it("throws ShelfError when database query fails", async () => {
      teamMemberFindFirstMock.mockResolvedValue({ id: "tm-1" } as any);
      teamMemberNoteFindManyMock.mockRejectedValue(
        new Error("Database timeout")
      );

      await expect(
        getTeamMemberNotes({
          teamMemberId: "tm-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        getTeamMemberNotes({
          teamMemberId: "tm-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(
        "Something went wrong while fetching the team member notes."
      );
    });
  });

  describe("deleteTeamMemberNote", () => {
    it("deletes note scoped by id, author, and workspace", async () => {
      teamMemberNoteDeleteManyMock.mockResolvedValue({ count: 1 });

      const result = await deleteTeamMemberNote({
        id: "tmnote-1",
        userId: "admin-1",
        organizationId: "org-1",
      });

      /* id + userId + organizationId in the where clause enforces both authorship AND workspace isolation */
      expect(teamMemberNoteDeleteManyMock).toHaveBeenCalledWith({
        where: { id: "tmnote-1", userId: "admin-1", organizationId: "org-1" },
      });
      expect(result).toEqual({ count: 1 });
    });

    it("throws 403 when note does not exist or user is not the author", async () => {
      teamMemberNoteDeleteManyMock.mockResolvedValue({ count: 0 });

      await expect(
        deleteTeamMemberNote({
          id: "nonexistent-note",
          userId: "admin-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(
        "Note not found or you don't have permission to delete it."
      );
    });

    it("throws 403 when note exists in a different workspace", async () => {
      /* Simulates cross-workspace deletion attempt: note exists but not in org-other */
      teamMemberNoteDeleteManyMock.mockResolvedValue({ count: 0 });

      await expect(
        deleteTeamMemberNote({
          id: "tmnote-1",
          userId: "admin-1",
          organizationId: "org-other",
        })
      ).rejects.toMatchObject({
        status: 403,
        message: "Note not found or you don't have permission to delete it.",
      });
    });

    it("throws ShelfError when database operation fails", async () => {
      teamMemberNoteDeleteManyMock.mockRejectedValue(
        new Error("Database error")
      );

      await expect(
        deleteTeamMemberNote({
          id: "tmnote-1",
          userId: "admin-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        deleteTeamMemberNote({
          id: "tmnote-1",
          userId: "admin-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(
        "Something went wrong while deleting the team member note."
      );
    });
  });
});
