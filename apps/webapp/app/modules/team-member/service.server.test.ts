import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamMember } from "@factories";

import {
  fixTeamMembersNames,
  getTeamMember,
} from "~/modules/team-member/service.server";
import { ShelfError } from "~/utils/error";

const dbMocks = vi.hoisted(() => ({
  teamMember: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
}));

// why: testing service error handling and data transformation without database dependency
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findUniqueOrThrow: dbMocks.teamMember.findUniqueOrThrow,
      update: dbMocks.teamMember.update,
    },
  },
}));

const mockTeamMemberFindUniqueOrThrow = dbMocks.teamMember.findUniqueOrThrow;
const mockTeamMemberUpdate = dbMocks.teamMember.update;

const mockTeamMember = createTeamMember();

beforeEach(() => {
  vi.clearAllMocks();
  mockTeamMemberFindUniqueOrThrow.mockReset();
  mockTeamMemberUpdate.mockReset();
  mockTeamMemberUpdate.mockResolvedValue({});
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
      } catch (_error) {
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

describe("fixTeamMembersNames", () => {
  /** Convenience alias for the (non-exported) element type of the argument. */
  type Member = Parameters<typeof fixTeamMembersNames>[0][number];

  /**
   * Builds a team-member shaped for `fixTeamMembersNames` on top of the shared
   * `createTeamMember` factory. The factory supplies the real (type-checked)
   * TeamMember scalar fields — so a schema change surfaces here instead of
   * silently drifting — and only the narrow `user` projection the function
   * actually reads (`firstName`/`lastName`/`displayName`/`email`) is layered on.
   */
  const makeMember = (over: {
    id: string;
    name: string;
    user: {
      firstName: string | null;
      lastName: string | null;
      email: string;
    } | null;
  }): Member => ({
    ...createTeamMember({
      id: over.id,
      name: over.name,
      organizationId: "org-1",
      userId: over.user ? "user-1" : null,
    }),
    user: over.user ? { ...over.user, displayName: null } : null,
  });

  it("updates only user-linked members whose name is blank", async () => {
    const members: Member[] = [
      makeMember({
        id: "tm-blank-user",
        name: "",
        user: { firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
      }),
      makeMember({
        id: "tm-named-user",
        name: "Already Named",
        user: { firstName: "John", lastName: "Roe", email: "john@example.com" },
      }),
    ];

    await fixTeamMembersNames(members);

    // Only the blank-named, user-linked member is fixed.
    expect(mockTeamMemberUpdate).toHaveBeenCalledTimes(1);
    expect(mockTeamMemberUpdate).toHaveBeenCalledWith({
      where: { id: "tm-blank-user", organizationId: "org-1" },
      data: { name: "Jane Doe" },
    });
  });

  it("ignores NRMs (user === null) even when blank-named", async () => {
    const members: Member[] = [
      makeMember({ id: "tm-nrm-blank", name: "", user: null }),
      makeMember({ id: "tm-nrm-blank-2", name: "   ", user: null }),
    ];

    await fixTeamMembersNames(members);

    // NRMs cannot be name-fixed; the early-return must not be defeated by them.
    expect(mockTeamMemberUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when no user-linked member is blank-named", async () => {
    const members: Member[] = [
      makeMember({
        id: "tm-named",
        name: "Has Name",
        user: { firstName: "A", lastName: "B", email: "a@example.com" },
      }),
    ];

    await fixTeamMembersNames(members);

    expect(mockTeamMemberUpdate).not.toHaveBeenCalled();
  });

  it("derives a name from the email username when the user has no first/last name", async () => {
    const members: Member[] = [
      makeMember({
        id: "tm-email-only",
        name: "",
        user: {
          firstName: null,
          lastName: null,
          email: "john.doe@example.com",
        },
      }),
    ];

    await fixTeamMembersNames(members);

    expect(mockTeamMemberUpdate).toHaveBeenCalledWith({
      where: { id: "tm-email-only", organizationId: "org-1" },
      data: { name: "John Doe" },
    });
  });

  it("does not throw when a DB update fails (runs fire-and-forget)", async () => {
    // why: the function runs in the background and its callers `void` it, so a
    // failed update must be caught + logged internally, never rejected.
    mockTeamMemberUpdate.mockRejectedValue(new Error("db down"));

    const members: Member[] = [
      makeMember({
        id: "tm-blank-user",
        name: "",
        user: { firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
      }),
    ];

    await expect(fixTeamMembersNames(members)).resolves.toBeUndefined();
  });
});
