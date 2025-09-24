import type { Organization, TeamMember } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTeamMember } from "~/modules/team-member/service.server";
import { ShelfError } from "~/utils/error";

const dbMocks = vi.hoisted(() => ({
  teamMember: {
    findUniqueOrThrow: vi.fn(),
  },
}));

vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findUniqueOrThrow: dbMocks.teamMember.findUniqueOrThrow,
    },
  },
}));

const mockTeamMemberFindUniqueOrThrow = dbMocks.teamMember.findUniqueOrThrow;

const mockTeamMember: TeamMember = {
  id: "team-member-123",
  userId: "user-456",
  name: "John Doe",
  organizationId: "org-789" as Organization["id"],
  deletedAt: null,
  createdAt: new Date("2023-01-01"),
  updatedAt: new Date("2023-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTeamMemberFindUniqueOrThrow.mockReset();
});

describe("getTeamMember", () => {
  describe("basic functionality", () => {
    it("should return team member when found", async () => {
      mockTeamMemberFindUniqueOrThrow.mockResolvedValue(mockTeamMember);

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
      });

      expect(result).toEqual(mockTeamMember);
      expect(mockTeamMemberFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "team-member-123", organizationId: "org-789" },
      });
    });

    it("should throw ShelfError when team member not found", async () => {
      const dbError = new Error("Record not found");
      mockTeamMemberFindUniqueOrThrow.mockRejectedValue(dbError);

      await expect(
        getTeamMember({
          id: "nonexistent-id",
          organizationId: "org-789",
        })
      ).rejects.toThrow(ShelfError);

      await expect(
        getTeamMember({
          id: "nonexistent-id",
          organizationId: "org-789",
        })
      ).rejects.toThrow("The selected team member could not be found.");
    });

    it("should validate organization ID", async () => {
      mockTeamMemberFindUniqueOrThrow.mockResolvedValue(mockTeamMember);

      await getTeamMember({
        id: "team-member-123",
        organizationId: "different-org",
      });

      expect(mockTeamMemberFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "team-member-123", organizationId: "different-org" },
      });
    });
  });

  describe("select functionality", () => {
    it("should return only selected fields", async () => {
      const selectedData = { id: "team-member-123", userId: "user-456" };
      mockTeamMemberFindUniqueOrThrow.mockResolvedValue(selectedData);

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        select: { id: true, userId: true },
      });

      expect(result).toEqual(selectedData);
      expect(mockTeamMemberFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "team-member-123", organizationId: "org-789" },
        select: { id: true, userId: true },
      });
    });

    it("should handle complex select queries", async () => {
      const selectedData = {
        id: "team-member-123",
        name: "John Doe",
        role: "MEMBER",
      };
      mockTeamMemberFindUniqueOrThrow.mockResolvedValue(selectedData);

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        select: { id: true, name: true, role: true },
      });

      expect(result).toEqual(selectedData);
      expect(mockTeamMemberFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "team-member-123", organizationId: "org-789" },
        select: { id: true, name: true, role: true },
      });
    });
  });

  describe("include functionality", () => {
    it("should return team member with included relations", async () => {
      const includedData = {
        ...mockTeamMember,
        user: { id: "user-456", email: "john@example.com" },
      };
      mockTeamMemberFindUniqueOrThrow.mockResolvedValue(includedData);

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        include: { user: true },
      });

      expect(result).toEqual(includedData);
      expect(mockTeamMemberFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "team-member-123", organizationId: "org-789" },
        include: { user: true },
      });
    });

    it("should handle complex include queries", async () => {
      const includedData = {
        ...mockTeamMember,
        user: { id: "user-456", email: "john@example.com" },
        organization: { id: "org-789", name: "Test Org" },
      };
      mockTeamMemberFindUniqueOrThrow.mockResolvedValue(includedData);

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        include: { user: true, organization: true },
      });

      expect(result).toEqual(includedData);
      expect(mockTeamMemberFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "team-member-123", organizationId: "org-789" },
        include: { user: true, organization: true },
      });
    });
  });

  describe("parameter validation", () => {
    it("should throw error when both select and include are provided", async () => {
      await expect(
        getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
          select: { id: true },
          include: { user: true },
        } as any) // Type assertion needed since TypeScript prevents this at compile time
      ).rejects.toThrow(ShelfError);

      await expect(
        getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
          select: { id: true },
          include: { user: true },
        } as any)
      ).rejects.toThrow(
        "Cannot use both select and include when fetching a team member."
      );

      // Should not call database when validation fails
      expect(mockTeamMemberFindUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("should not call database when select/include validation fails", async () => {
      try {
        await getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
          select: { id: true },
          include: { user: true },
        } as any);
      } catch (error) {
        // Expected to throw
      }

      expect(mockTeamMemberFindUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should re-throw ShelfError when database throws ShelfError", async () => {
      const originalError = new ShelfError({
        cause: null,
        message: "Custom error",
        additionalData: {},
        label: "Assets",
      });

      mockTeamMemberFindUniqueOrThrow.mockRejectedValue(originalError);

      await expect(
        getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
        })
      ).rejects.toBe(originalError);
    });

    it("should wrap generic database errors in ShelfError", async () => {
      const dbError = new Error("Database connection failed");
      mockTeamMemberFindUniqueOrThrow.mockRejectedValue(dbError);

      await expect(
        getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
        })
      ).rejects.toThrow(ShelfError);

      try {
        await getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ShelfError);
        expect((error as ShelfError).cause).toBe(dbError);
        expect((error as ShelfError).additionalData).toEqual({
          id: "team-member-123",
          organizationId: "org-789",
        });
      }
    });

    it("should include correct error details in ShelfError", async () => {
      const dbError = new Error("Record not found");
      mockTeamMemberFindUniqueOrThrow.mockRejectedValue(dbError);

      try {
        await getTeamMember({
          id: "missing-member",
          organizationId: "test-org",
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ShelfError);
        const shelfError = error as ShelfError;
        expect(shelfError.title).toBe("Team member not found");
        expect(shelfError.message).toBe(
          "The selected team member could not be found."
        );
        expect(shelfError.additionalData).toEqual({
          id: "missing-member",
          organizationId: "test-org",
        });
        expect(shelfError.status).toBe(404);
      }
    });
  });
});
