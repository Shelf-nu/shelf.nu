import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamMember } from "@factories";

import { getTeamMember } from "~/modules/team-member/service.server";
import { ShelfError } from "~/utils/error";

/**
 * Creates a chainable mock that simulates sbDb.from("TeamMember").select(...).eq(...).eq(...).single()
 * The final method in the chain (single) resolves with { data, error }.
 */
function createSupabaseChainMock(resolvedValue: {
  data: unknown;
  error: unknown;
}) {
  const single = vi.fn().mockResolvedValue(resolvedValue);
  const _eq = vi
    .fn()
    .mockReturnValue({ eq: vi.fn().mockReturnValue({ single }), single });

  // We need a proper chain: select -> eq -> eq -> single
  // Each eq call returns an object with eq and single
  const makeEq: () => Record<string, ReturnType<typeof vi.fn>> = () => {
    const eqFn: ReturnType<typeof vi.fn> = vi.fn().mockImplementation(() => ({
      eq: eqFn,
      single,
    }));
    return { eq: eqFn, single };
  };

  const chain = makeEq();
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });

  return { from, select, single, eq: chain.eq };
}

const mockTeamMember = createTeamMember();

let sbDbMock: ReturnType<typeof createSupabaseChainMock>;

// why: testing service error handling and data transformation without database dependency
vi.mock("~/database/supabase.server", () => ({
  get sbDb() {
    return {
      from: (...args: unknown[]) => sbDbMock.from(...args),
    };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  sbDbMock = createSupabaseChainMock({ data: null, error: null });
});

describe("getTeamMember", () => {
  describe("basic functionality", () => {
    it("should return team member when found", async () => {
      sbDbMock = createSupabaseChainMock({
        data: mockTeamMember,
        error: null,
      });

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
      });

      expect(result).toEqual(mockTeamMember);
      expect(sbDbMock.from).toHaveBeenCalledWith("TeamMember");
      expect(sbDbMock.select).toHaveBeenCalledWith("*");
    });

    it("should throw ShelfError when team member not found", async () => {
      sbDbMock = createSupabaseChainMock({
        data: null,
        error: new Error("Record not found"),
      });

      await expect(
        getTeamMember({
          id: "nonexistent-id",
          organizationId: "org-789",
        })
      ).rejects.toThrow(ShelfError);

      sbDbMock = createSupabaseChainMock({
        data: null,
        error: new Error("Record not found"),
      });

      await expect(
        getTeamMember({
          id: "nonexistent-id",
          organizationId: "org-789",
        })
      ).rejects.toThrow("The selected team member could not be found.");
    });

    it("should pass correct filters", async () => {
      sbDbMock = createSupabaseChainMock({
        data: mockTeamMember,
        error: null,
      });

      await getTeamMember({
        id: "team-member-123",
        organizationId: "different-org",
      });

      expect(sbDbMock.from).toHaveBeenCalledWith("TeamMember");
      // Verify eq was called (chain: .eq("id", ...).eq("organizationId", ...))
      expect(sbDbMock.eq).toHaveBeenCalledWith("id", "team-member-123");
    });
  });

  describe("select functionality", () => {
    it("should return only selected fields", async () => {
      const selectedData = { id: "team-member-123", userId: "user-456" };
      sbDbMock = createSupabaseChainMock({
        data: selectedData,
        error: null,
      });

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        select: { id: true, userId: true },
      });

      expect(result).toEqual(selectedData);
      expect(sbDbMock.select).toHaveBeenCalledWith("id, userId");
    });

    it("should handle complex select queries", async () => {
      const selectedData = {
        id: "team-member-123",
        name: "John Doe",
        role: "MEMBER",
      };
      sbDbMock = createSupabaseChainMock({
        data: selectedData,
        error: null,
      });

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        select: { id: true, name: true, role: true },
      });

      expect(result).toEqual(selectedData);
      expect(sbDbMock.select).toHaveBeenCalledWith("id, name, role");
    });
  });

  describe("include functionality", () => {
    it("should return team member with included relations", async () => {
      const includedData = {
        ...mockTeamMember,
        user: { id: "user-456", email: "john@example.com" },
      };
      sbDbMock = createSupabaseChainMock({
        data: includedData,
        error: null,
      });

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        include: { user: true },
      });

      expect(result).toEqual(includedData);
      expect(sbDbMock.select).toHaveBeenCalledWith("*, user:User(*)");
    });

    it("should handle complex include queries", async () => {
      const includedData = {
        ...mockTeamMember,
        user: { id: "user-456", email: "john@example.com" },
        organization: { id: "org-789", name: "Test Org" },
      };
      sbDbMock = createSupabaseChainMock({
        data: includedData,
        error: null,
      });

      const result = await getTeamMember({
        id: "team-member-123",
        organizationId: "org-789",
        include: { user: true, organization: true },
      });

      expect(result).toEqual(includedData);
      expect(sbDbMock.select).toHaveBeenCalledWith(
        "*, user:User(*), organization:Organization(*)"
      );
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
      expect(sbDbMock.from).not.toHaveBeenCalled();
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

      expect(sbDbMock.from).not.toHaveBeenCalled();
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

      sbDbMock = createSupabaseChainMock({
        data: null,
        error: originalError,
      });

      await expect(
        getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
        })
      ).rejects.toBe(originalError);
    });

    it("should wrap generic database errors in ShelfError", async () => {
      const dbError = new Error("Database connection failed");
      sbDbMock = createSupabaseChainMock({
        data: null,
        error: dbError,
      });

      await expect(
        getTeamMember({
          id: "team-member-123",
          organizationId: "org-789",
        })
      ).rejects.toThrow(ShelfError);

      sbDbMock = createSupabaseChainMock({
        data: null,
        error: dbError,
      });

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
      sbDbMock = createSupabaseChainMock({
        data: null,
        error: dbError,
      });

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
