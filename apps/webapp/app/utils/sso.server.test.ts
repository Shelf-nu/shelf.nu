import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// why: isolate from Prisma — we only verify the resolve function's branching
vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
  },
}));

// why: control getAuthUserById return + simulate Supabase failures
vi.mock("~/modules/auth/service.server", () => ({
  getAuthUserById: vi.fn(),
  deleteAuthAccount: vi.fn(),
}));

// why: verify downstream SSO calls without booting the user module
vi.mock("~/modules/user/service.server", () => ({
  createUserFromSSO: vi.fn(),
  updateUserFromSSO: vi.fn(),
}));

// why: organization helpers are imported at module load but not exercised here
vi.mock("~/modules/organization/service.server", () => ({
  emailMatchesDomains: vi.fn(),
  parseDomains: vi.fn(),
}));

const mockDb = await import("~/database/db.server");
const mockAuth = await import("~/modules/auth/service.server");
const mockUser = await import("~/modules/user/service.server");

import { resolveUserAndOrgForSsoCallback } from "~/utils/sso.server";

const SUPABASE_UUID = "auth-user-supabase-uuid";

const baseAuthSession = {
  userId: SUPABASE_UUID,
  email: "jane@example.com",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresIn: 3600,
  expiresAt: Date.now() + 3600_000,
};

const baseInput = {
  authSession: baseAuthSession,
  firstName: "Jane",
  lastName: "Doe",
  groups: [] as string[],
};

const shelfUser = {
  id: SUPABASE_UUID,
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  displayName: "Jane Doe",
  sso: true,
  userOrganizations: [],
};

/**
 * Mirrors how getAuthUserById wraps its cause: ShelfError with the
 * underlying AuthApiError attached as `cause`.
 */
function wrappedAuthError(status: number, message = "auth error") {
  return new ShelfError({
    cause: new AuthApiError(message, status, "err_code"),
    message: "Something went wrong while getting the auth user by id",
    label: "Auth",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveUserAndOrgForSsoCallback", () => {
  describe("existing user flows", () => {
    it("rejects when the email is linked to an email-auth account", async () => {
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(shelfUser);
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: shelfUser.id,
        app_metadata: { provider: "email" },
      });

      await expect(resolveUserAndOrgForSsoCallback(baseInput)).rejects.toThrow(
        /linked to a personal account/
      );

      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
      expect(mockUser.createUserFromSSO).not.toHaveBeenCalled();
      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it("updates an existing SSO user when the Supabase auth account already exists", async () => {
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(shelfUser);
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: shelfUser.id,
        app_metadata: { provider: "sso:abc-provider" },
      });
      const updated = {
        user: { id: shelfUser.id, email: shelfUser.email },
        org: { id: "org-1" },
      };
      // @ts-expect-error - vitest mock type
      mockUser.updateUserFromSSO.mockResolvedValue(updated);

      const result = await resolveUserAndOrgForSsoCallback(baseInput);

      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).toHaveBeenCalledWith(
        baseAuthSession,
        shelfUser,
        expect.objectContaining({
          firstName: "Jane",
          lastName: "Doe",
          groups: [],
        })
      );
      expect(result).toEqual(updated);
    });

    it("rewrites a SCIM-placeholder user ID to match the Supabase UUID when no auth account exists", async () => {
      const scimPlaceholderUser = {
        ...shelfUser,
        id: "cuid-placeholder-from-scim",
      };
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(scimPlaceholderUser);
      // Supabase returns a genuine 404 — the SCIM-provisioned user has no
      // auth account yet, so the ID rewrite should run.
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockRejectedValue(wrappedAuthError(404));
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
        ...scimPlaceholderUser,
        id: SUPABASE_UUID,
      });
      const updated = { user: { id: SUPABASE_UUID }, org: { id: "org-1" } };
      // @ts-expect-error - vitest mock type
      mockUser.updateUserFromSSO.mockResolvedValue(updated);

      const result = await resolveUserAndOrgForSsoCallback(baseInput);

      expect(mockDb.db.$executeRawUnsafe).toHaveBeenCalledWith(
        `UPDATE "User" SET id = $1 WHERE id = $2`,
        SUPABASE_UUID,
        "cuid-placeholder-from-scim"
      );
      expect(mockUser.updateUserFromSSO).toHaveBeenCalledWith(
        baseAuthSession,
        expect.objectContaining({ id: SUPABASE_UUID }),
        expect.any(Object)
      );
      expect(result).toEqual(updated);
    });

    it("skips the ID rewrite when the user already has the Supabase UUID", async () => {
      // user.id already === authSession.userId
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(shelfUser);
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockRejectedValue(wrappedAuthError(404));
      // @ts-expect-error - vitest mock type
      mockUser.updateUserFromSSO.mockResolvedValue({
        user: { id: shelfUser.id },
        org: { id: "org-1" },
      });

      await resolveUserAndOrgForSsoCallback(baseInput);

      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockDb.db.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).toHaveBeenCalledWith(
        baseAuthSession,
        shelfUser,
        expect.any(Object)
      );
    });
  });

  describe("new user flow", () => {
    it("creates a new user when no existing Shelf user is found", async () => {
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(null);
      const created = { user: { id: "new-user" }, org: { id: "org-1" } };
      // @ts-expect-error - vitest mock type
      mockUser.createUserFromSSO.mockResolvedValue(created);

      const result = await resolveUserAndOrgForSsoCallback(baseInput);

      expect(mockAuth.getAuthUserById).not.toHaveBeenCalled();
      expect(mockUser.createUserFromSSO).toHaveBeenCalledWith(
        baseAuthSession,
        expect.objectContaining({
          firstName: "Jane",
          lastName: "Doe",
          groups: [],
        })
      );
      expect(mockAuth.deleteAuthAccount).not.toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it("cleans up the Supabase auth account when new-user creation fails", async () => {
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(null);
      // @ts-expect-error - vitest mock type
      mockUser.createUserFromSSO.mockRejectedValue(
        new Error("db write failed")
      );

      await expect(
        resolveUserAndOrgForSsoCallback(baseInput)
      ).rejects.toThrow();

      expect(mockAuth.deleteAuthAccount).toHaveBeenCalledWith(SUPABASE_UUID);
    });
  });

  describe("transient getAuthUserById errors", () => {
    // Regression guard: before this was fixed, any error from getAuthUserById
    // was swallowed and authUser set to null, which then triggered the
    // destructive `UPDATE "User" SET id = ...` for SCIM-placeholder users.

    it("rethrows non-404 Supabase errors instead of treating them as 'user not found'", async () => {
      const scimPlaceholderUser = {
        ...shelfUser,
        id: "cuid-placeholder-from-scim",
      };
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(scimPlaceholderUser);
      // Rate-limited (429) — must NOT trigger the ID rewrite.
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockRejectedValue(
        wrappedAuthError(429, "Rate limited")
      );

      await expect(
        resolveUserAndOrgForSsoCallback(baseInput)
      ).rejects.toThrow();

      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
    });

    it("rethrows generic (non-AuthApiError) failures from getAuthUserById", async () => {
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(shelfUser);
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockRejectedValue(new Error("network timeout"));

      await expect(
        resolveUserAndOrgForSsoCallback(baseInput)
      ).rejects.toThrow();

      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
    });
  });
});
