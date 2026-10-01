import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// why: isolate from Prisma — we only verify each function's branching.
// `$queryRaw` stands in for the auth.sso_domains lookup (a raw query because
// the auth schema is outside Prisma's model set) and `organization.findMany`
// for the domain-ownership lookup.
vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    organization: {
      findMany: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
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

// why: the reconcile engine writes to the auth schema and is covered by its own
// tests; here we only verify when the callback hands off to it
vi.mock("~/modules/auth/sso-conversion.server", () => ({
  reconcileDuplicateSsoLogin: vi.fn(),
}));

const mockDb = await import("~/database/db.server");
const mockAuth = await import("~/modules/auth/service.server");
const mockUser = await import("~/modules/user/service.server");
const mockConversion = await import("~/modules/auth/sso-conversion.server");

import {
  checkDomainSSOStatus,
  resolveUserAndOrgForSsoCallback,
} from "~/utils/sso.server";

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
 * A standard (email/password) account whose Shelf id is its own auth UUID,
 * different from the SSO auth user that just authenticated.
 */
const ORIGINAL_UUID = "original-standard-account-uuid";

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
    it("rejects an un-approved email-auth account without reconciling it", async () => {
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue({
        ...shelfUser,
        id: ORIGINAL_UUID,
        sso: false,
      });
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: ORIGINAL_UUID,
        app_metadata: { provider: "email" },
      });

      await expect(resolveUserAndOrgForSsoCallback(baseInput)).rejects.toThrow(
        /linked to a personal account/
      );

      expect(mockAuth.getAuthUserById).toHaveBeenCalledWith(ORIGINAL_UUID);
      expect(mockConversion.reconcileDuplicateSsoLogin).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
      expect(mockUser.createUserFromSSO).not.toHaveBeenCalled();
      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it("updates a user whose id is the authenticated auth UUID without looking up the auth user", async () => {
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(shelfUser);
      // A converted account keeps its original auth user, whose provider can
      // still read "email". The same-UUID login must not reach that check.
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: shelfUser.id,
        app_metadata: { provider: "email" },
      });
      const updated = {
        user: { id: shelfUser.id, email: shelfUser.email },
        org: { id: "org-1" },
      };
      // @ts-expect-error - vitest mock type
      mockUser.updateUserFromSSO.mockResolvedValue(updated);

      const result = await resolveUserAndOrgForSsoCallback(baseInput);

      expect(mockAuth.getAuthUserById).not.toHaveBeenCalled();
      expect(mockConversion.reconcileDuplicateSsoLogin).not.toHaveBeenCalled();
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
      // sso=true, so this also proves a missing auth account takes the re-key
      // path rather than the duplicate reconcile.
      const scimPlaceholderUser = {
        ...shelfUser,
        id: "cuid-placeholder-from-scim",
        sso: true,
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
      expect(mockConversion.reconcileDuplicateSsoLogin).not.toHaveBeenCalled();
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

      expect(mockAuth.getAuthUserById).not.toHaveBeenCalled();
      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockDb.db.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).toHaveBeenCalledWith(
        baseAuthSession,
        shelfUser,
        expect.any(Object)
      );
    });
  });

  describe("duplicate SSO auth user for an approved account", () => {
    it("reconciles the duplicate, then asks the user to sign in again", async () => {
      const approvedUser = { ...shelfUser, id: ORIGINAL_UUID, sso: true };
      // @ts-expect-error - vitest mock type
      mockDb.db.user.findUnique.mockResolvedValue(approvedUser);
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: ORIGINAL_UUID,
        app_metadata: { provider: "email" },
      });
      // @ts-expect-error - vitest mock type
      mockConversion.reconcileDuplicateSsoLogin.mockResolvedValue(undefined);

      const error = await resolveUserAndOrgForSsoCallback(baseInput).catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(ShelfError);
      expect(error).toMatchObject({
        status: 400,
        title: "Your account is now SSO-enabled",
        message: expect.stringMatching(/sign in again/),
        shouldBeCaptured: false,
      });
      expect(mockConversion.reconcileDuplicateSsoLogin).toHaveBeenCalledWith({
        authSession: baseAuthSession,
        existingUser: {
          id: ORIGINAL_UUID,
          email: approvedUser.email,
          sso: true,
        },
      });
      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
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
        }),
        // 3rd arg: browser-detected format prefs forwarded to the new-user
        // branch. Undefined here — this call site passes no hints.
        undefined
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
    // Only a genuine 404 may be read as "no auth account": that reading
    // triggers the destructive `UPDATE "User" SET id = ...` re-key.

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
      mockDb.db.user.findUnique.mockResolvedValue({
        ...shelfUser,
        id: ORIGINAL_UUID,
      });
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockRejectedValue(new Error("network timeout"));

      await expect(
        resolveUserAndOrgForSsoCallback(baseInput)
      ).rejects.toThrow();

      expect(mockAuth.getAuthUserById).toHaveBeenCalledWith(ORIGINAL_UUID);
      expect(mockConversion.reconcileDuplicateSsoLogin).not.toHaveBeenCalled();
      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
    });
  });
});

describe("checkDomainSSOStatus", () => {
  /**
   * Builds an organization row in the shape the function's `include` produces.
   *
   * @param id - Organization id
   * @param domains - The organization's comma-separated `ssoDetails.domain`
   */
  function orgWithDomains(id: string, domains: string) {
    return { id, name: id, ssoDetails: { id: `sso-${id}`, domain: domains } };
  }

  /** Marks the queried domain as federated at the auth layer. */
  function federated() {
    // @ts-expect-error mock setup
    mockDb.db.$queryRaw.mockResolvedValue([{ ssoProviderId: "provider-1" }]);
  }

  it("reports a domain nobody has federated as not configured for SSO", async () => {
    // @ts-expect-error mock setup
    mockDb.db.$queryRaw.mockResolvedValue([]);

    await expect(checkDomainSSOStatus("jane@example.com")).resolves.toEqual({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
      ssoProviderId: null,
    });
  });

  it("links the organization that claims the domain", async () => {
    // The SCIM-governance check downstream looks for the invited-to
    // organization in this list, so an empty one reads as Pure SSO and lets a
    // manual invite through.
    federated();
    // @ts-expect-error mock setup
    mockDb.db.organization.findMany.mockResolvedValue([
      orgWithDomains("org-acme", "acme.com,acme.co.uk"),
    ]);

    const result = await checkDomainSSOStatus("jane@acme.com");

    expect(result.isConfiguredForSSO).toBe(true);
    expect(result.linkedOrganizations.map((org) => org.id)).toEqual([
      "org-acme",
    ]);
    expect(result.ssoProviderId).toBe("provider-1");
  });

  it("links every organization that claims the domain", async () => {
    // `SsoDetails.domain` has no unique constraint and one SsoDetails row is
    // shared by an `Organization[]`, so co-ownership is a supported state.
    // Answering with a single owner exempts the others from the SCIM rule.
    federated();
    // @ts-expect-error mock setup
    mockDb.db.organization.findMany.mockResolvedValue([
      orgWithDomains("org-acme-eu", "acme.com"),
      orgWithDomains("org-acme-us", "acme.com,acme.us"),
    ]);

    const result = await checkDomainSSOStatus("jane@acme.com");

    expect(result.linkedOrganizations.map((org) => org.id)).toEqual([
      "org-acme-eu",
      "org-acme-us",
    ]);
  });

  it("does not link an organization whose domain merely contains the queried one", async () => {
    // The database can only narrow a comma-separated column by substring, so
    // "notacme.com" comes back for "acme.com" and must be rejected here.
    federated();
    // @ts-expect-error mock setup
    mockDb.db.organization.findMany.mockResolvedValue([
      orgWithDomains("org-other", "notacme.com"),
    ]);

    const result = await checkDomainSSOStatus("jane@acme.com");

    expect(result.isConfiguredForSSO).toBe(true);
    expect(result.linkedOrganizations).toEqual([]);
  });

  it("finds the real owner past a substring collision", async () => {
    // A single-row read would stop at "org-other", exact-match it to false,
    // and report Pure SSO — silently skipping the organization that does own
    // the domain.
    federated();
    // @ts-expect-error mock setup
    mockDb.db.organization.findMany.mockResolvedValue([
      orgWithDomains("org-other", "notacme.com"),
      orgWithDomains("org-acme", "acme.com"),
    ]);

    const result = await checkDomainSSOStatus("jane@acme.com");

    expect(result.linkedOrganizations.map((org) => org.id)).toEqual([
      "org-acme",
    ]);
  });

  it("matches the domain case-insensitively", async () => {
    federated();
    // @ts-expect-error mock setup
    mockDb.db.organization.findMany.mockResolvedValue([
      orgWithDomains("org-acme", "ACME.com"),
    ]);

    const result = await checkDomainSSOStatus("Jane@Acme.COM");

    expect(result.linkedOrganizations.map((org) => org.id)).toEqual([
      "org-acme",
    ]);
  });

  it("asks the database for candidates case-insensitively", async () => {
    // The exact match above runs on rows the query already returned, so it
    // cannot prove anything about rows the query excludes. Stored casing is
    // unconstrained, and a case-sensitive `contains` would drop "ACME.com"
    // before any of this code runs — assert the filter itself.
    federated();
    // @ts-expect-error mock setup
    mockDb.db.organization.findMany.mockResolvedValue([]);

    await checkDomainSSOStatus("jane@acme.com");

    expect(mockDb.db.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ssoDetails: {
            domain: { contains: "acme.com", mode: "insensitive" },
          },
        },
      })
    );
  });

  it("returns not-configured for an address with no domain", async () => {
    await expect(checkDomainSSOStatus("not-an-email")).resolves.toEqual({
      isConfiguredForSSO: false,
      linkedOrganizations: [],
      ssoProviderId: null,
    });

    // Nothing to look up, so neither query runs.
    expect(mockDb.db.$queryRaw).not.toHaveBeenCalled();
    expect(mockDb.db.organization.findMany).not.toHaveBeenCalled();
  });
});
