import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { ShelfError } from "~/utils/error";

// why: isolate from Prisma — we only verify each function's branching.
// `$queryRaw` stands in for the auth.sso_domains and auth.identities lookups
// (raw queries because the auth schema is outside Prisma's model set) and
// `organization.findMany`
// for the domain-ownership lookup.
vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
    },
    organization: {
      findMany: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

// why: control getAuthUserById return + simulate Supabase failures, and
// observe the session revocation without calling Supabase Auth
vi.mock("~/modules/auth/service.server", () => ({
  getAuthUserById: vi.fn(),
  deleteAuthAccount: vi.fn(),
  revokeSession: vi.fn(),
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
  assertSsoAuthenticatedSession,
  checkDomainSSOStatus,
  getSsoClaimsForAuthUser,
  isSsoAccountLinkedError,
  normalizeSsoGroups,
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

/** A Shelf user row as the callback's lookups return it. */
type SeededUser = { id: string; email: string } & Record<string, unknown>;

/**
 * Seeds the Shelf users the callback can find, answering the two lookups the
 * way the database does: `findUnique` by exact id, `findMany` by email without
 * regard to letter case.
 *
 * @param users - every Shelf user that exists for this test
 */
function seedUsers(...users: SeededUser[]) {
  vi.mocked(mockDb.db.user.findUnique).mockImplementation(((args: {
    where: { id?: string };
  }) =>
    Promise.resolve(
      users.find((u) => u.id === args.where.id) ?? null
    )) as unknown as typeof mockDb.db.user.findUnique);
  vi.mocked(mockDb.db.user.findMany).mockImplementation(((args: {
    where: { email: { in: string[] } };
  }) =>
    Promise.resolve(
      users.filter((u) => args.where.email.in.includes(u.email.toLowerCase()))
    )) as unknown as typeof mockDb.db.user.findMany);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveUserAndOrgForSsoCallback", () => {
  describe("existing user flows", () => {
    it("rejects an un-approved email-auth account without reconciling it", async () => {
      seedUsers({
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
      seedUsers(shelfUser);
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

    it("refuses an un-approved email/password account matched by id, without updating it", async () => {
      seedUsers({ ...shelfUser, sso: false });
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: shelfUser.id,
        app_metadata: { provider: "email" },
      });

      await expect(resolveUserAndOrgForSsoCallback(baseInput)).rejects.toThrow(
        /linked to a personal account/
      );

      expect(mockAuth.getAuthUserById).toHaveBeenCalledWith(shelfUser.id);
      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
      expect(mockUser.createUserFromSSO).not.toHaveBeenCalled();
    });

    it("updates an un-approved account matched by id whose auth user is not an email account", async () => {
      seedUsers({ ...shelfUser, sso: false });
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: shelfUser.id,
        app_metadata: { provider: "sso:provider-1" },
      });
      // @ts-expect-error - vitest mock type
      mockUser.updateUserFromSSO.mockResolvedValue({
        user: { id: shelfUser.id },
        org: null,
      });

      await resolveUserAndOrgForSsoCallback(baseInput);

      expect(mockUser.updateUserFromSSO).toHaveBeenCalledTimes(1);
    });

    it("rewrites a SCIM-placeholder user ID to match the Supabase UUID when no auth account exists", async () => {
      // sso=true, so this also proves a missing auth account takes the re-key
      // path rather than the duplicate reconcile.
      const scimPlaceholderUser = {
        ...shelfUser,
        id: "cuid-placeholder-from-scim",
        sso: true,
      };
      seedUsers(scimPlaceholderUser);
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
      seedUsers(shelfUser);
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
    it("reconciles the duplicate, then reports the account as linked and asks for one more sign-in", async () => {
      const approvedUser = { ...shelfUser, id: ORIGINAL_UUID, sso: true };
      seedUsers(approvedUser);
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
      // The callback routes render this one as a success notice.
      expect(isSsoAccountLinkedError(error)).toBe(true);
      expect(error).toMatchObject({
        status: 409,
        title: "Your account is now on single sign-on",
        message:
          "Your account is now on single sign-on. Sign in again to continue.",
        additionalData: { ssoAccountLinked: true },
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

  describe("matching the Shelf account", () => {
    it("finds an approved account whose stored email differs in case", async () => {
      const approvedUser = {
        ...shelfUser,
        id: ORIGINAL_UUID,
        email: "Jane@Example.com",
        sso: true,
      };
      seedUsers(approvedUser);
      // @ts-expect-error - vitest mock type
      mockAuth.getAuthUserById.mockResolvedValue({
        id: ORIGINAL_UUID,
        app_metadata: { provider: "sso:provider" },
      });
      // @ts-expect-error - vitest mock type
      mockConversion.reconcileDuplicateSsoLogin.mockResolvedValue(undefined);

      await expect(resolveUserAndOrgForSsoCallback(baseInput)).rejects.toThrow(
        /Sign in again/
      );

      expect(mockConversion.reconcileDuplicateSsoLogin).toHaveBeenCalledWith({
        authSession: baseAuthSession,
        existingUser: {
          id: ORIGINAL_UUID,
          email: "Jane@Example.com",
          sso: true,
        },
      });
      expect(mockUser.createUserFromSSO).not.toHaveBeenCalled();
    });

    it("matches the account by its auth id even when the IdP sends a different email", async () => {
      const renamedUser = { ...shelfUser, email: "jane.old@example.com" };
      seedUsers(renamedUser);
      // @ts-expect-error - vitest mock type
      mockUser.updateUserFromSSO.mockResolvedValue({
        user: { id: renamedUser.id },
        org: null,
      });

      await resolveUserAndOrgForSsoCallback(baseInput);

      expect(mockUser.updateUserFromSSO).toHaveBeenCalledWith(
        baseAuthSession,
        renamedUser,
        expect.any(Object)
      );
      expect(mockUser.createUserFromSSO).not.toHaveBeenCalled();
    });

    it("refuses to pick between accounts whose emails differ only in case", async () => {
      seedUsers(
        { ...shelfUser, id: "account-a", email: "Jane@example.com", sso: true },
        { ...shelfUser, id: "account-b", email: "jane@Example.com", sso: true }
      );

      const error = await resolveUserAndOrgForSsoCallback(baseInput).catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(ShelfError);
      expect(error).toMatchObject({ status: 409 });
      expect(mockAuth.getAuthUserById).not.toHaveBeenCalled();
      expect(mockConversion.reconcileDuplicateSsoLogin).not.toHaveBeenCalled();
      expect(mockDb.db.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(mockUser.updateUserFromSSO).not.toHaveBeenCalled();
      expect(mockUser.createUserFromSSO).not.toHaveBeenCalled();
    });
  });

  describe("names the IdP did not provide", () => {
    it("keeps an existing account's stored names and still signs it in", async () => {
      seedUsers(shelfUser);
      // @ts-expect-error - vitest mock type
      mockUser.updateUserFromSSO.mockResolvedValue({
        user: { id: shelfUser.id },
        org: { id: "org-1" },
      });

      const result = await resolveUserAndOrgForSsoCallback({
        ...baseInput,
        firstName: null,
        lastName: null,
      });

      expect(mockUser.updateUserFromSSO).toHaveBeenCalledWith(
        baseAuthSession,
        shelfUser,
        expect.objectContaining({
          firstName: "Jane",
          lastName: "Doe",
          contactInfo: undefined,
        })
      );
      expect(result.org).toEqual({ id: "org-1" });
    });

    it("refuses to create a new account without names, with a 400", async () => {
      seedUsers();

      await expect(
        resolveUserAndOrgForSsoCallback({
          ...baseInput,
          firstName: null,
          lastName: null,
        })
      ).rejects.toMatchObject({
        status: 400,
        message:
          "Your organization's single sign-on did not provide your first and last name. Please contact your workspace administrator.",
      });
      expect(mockUser.createUserFromSSO).not.toHaveBeenCalled();
    });
  });

  describe("new user flow", () => {
    it("creates a new user when no existing Shelf user is found", async () => {
      seedUsers();
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
      seedUsers();
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
      seedUsers(scimPlaceholderUser);
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
      seedUsers({
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

/**
 * Builds an unsigned JWT the way GoTrue shapes its access tokens. Only the
 * payload segment is read, so the header and signature are placeholders.
 *
 * @param payload - the claims to encode
 * @returns a three-segment token string
 */
function accessTokenWithClaims(payload: Record<string, unknown>) {
  const segment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${segment}.signature`;
}

describe("assertSsoAuthenticatedSession", () => {
  /** A session carrying `accessToken`. */
  function sessionWith(accessToken: string) {
    return { ...baseAuthSession, accessToken };
  }

  /**
   * Runs the check and returns what it threw.
   *
   * @param accessToken - the token the session carries
   * @returns the thrown value, or undefined when the session is accepted
   */
  async function refusalOf(accessToken: string) {
    try {
      await assertSsoAuthenticatedSession(sessionWith(accessToken));
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it("accepts a session signed in through SAML, leaving it live", async () => {
    const token = accessTokenWithClaims({
      amr: [{ method: "sso/saml", timestamp: 1 }],
    });

    expect(await refusalOf(token)).toBeUndefined();
    expect(mockAuth.revokeSession).not.toHaveBeenCalled();
  });

  it("accepts the bare-string amr format custom access token hooks emit", async () => {
    const token = accessTokenWithClaims({ amr: ["sso/saml"] });

    expect(await refusalOf(token)).toBeUndefined();
  });

  it.each(["password", "otp", "magiclink"])(
    "refuses a session signed in by %s with a 403 and revokes it",
    async (method) => {
      const token = accessTokenWithClaims({
        amr: [{ method, timestamp: 1 }],
      });

      const error = await refusalOf(token);

      expect(mockAuth.revokeSession).toHaveBeenCalledWith(token);
      expect(error).toBeInstanceOf(ShelfError);
      expect((error as ShelfError).status).toBe(403);
      expect((error as ShelfError).message).toBe(
        "Please sign in with your organization's single sign-on."
      );
    }
  );

  it.each([
    ["a token with no payload segment", "not-a-jwt"],
    ["a payload that is not JSON", "header.%%%.signature"],
    ["a payload with no amr claim", accessTokenWithClaims({ sub: "x" })],
    [
      "an amr claim that is not a list",
      accessTokenWithClaims({ amr: "sso/saml" }),
    ],
  ])("refuses %s with a 403", async (_label, token) => {
    const error = await refusalOf(token);

    expect(error).toBeInstanceOf(ShelfError);
    expect((error as ShelfError).status).toBe(403);
  });
});

describe("getSsoClaimsForAuthUser", () => {
  /** The raw-query mock, typed loosely: Prisma's generic return type cannot be mocked. */
  const queryRaw = mockDb.db.$queryRaw as unknown as Mock;
  /** Same, for the organization lookup inside checkDomainSSOStatus. */
  const findOrgs = mockDb.db.organization.findMany as unknown as Mock;

  const args = { authUserId: SUPABASE_UUID, email: "jane@acme.com" };

  /**
   * Answers the two raw queries in order: the domain's provider lookup, then
   * the identity lookup (rows already ordered most recent first, as the
   * query's ORDER BY returns them).
   *
   * @param providerId - the provider registered for the domain, or null
   * @param identityRows - what the auth.identities query returns
   */
  function seed(
    providerId: string | null,
    identityRows: { provider: string; claims: unknown }[]
  ) {
    queryRaw
      .mockResolvedValueOnce(providerId ? [{ ssoProviderId: providerId }] : [])
      .mockResolvedValueOnce(identityRows);
    findOrgs.mockResolvedValue([]);
  }

  /** The SQL text and values of the identity query (the second raw query). */
  function identityQuery() {
    const [strings, ...values] = queryRaw.mock.calls[1] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return { sql: strings.join("?"), values };
  }

  const fullClaims = {
    groups: ["admins", "staff"],
    firstname: "Jane",
    lastname: "Doe",
    mobilephone: "555",
    streetAddress: "1 Main St",
    city: "Springfield",
    stateProvince: "IL",
    postalCode: "62701",
    country: "US",
  };

  it("reads every claim from the identity of the domain's own provider", async () => {
    seed("provider-1", [{ provider: "sso:provider-1", claims: fullClaims }]);

    const result = await getSsoClaimsForAuthUser(args);

    expect(result).toEqual({
      groups: ["admins", "staff"],
      firstName: "Jane",
      lastName: "Doe",
      contactInfo: {
        phone: "555",
        street: "1 Main St",
        city: "Springfield",
        stateProvince: "IL",
        zipPostalCode: "62701",
        countryRegion: "US",
      },
    });
    const { sql, values } = identityQuery();
    expect(sql).toContain("FROM auth.identities");
    expect(sql).toContain("provider LIKE 'sso:%'");
    expect(sql).toContain("identity_data -> 'custom_claims' IS NOT NULL");
    expect(sql).toContain("ORDER BY last_sign_in_at DESC NULLS LAST");
    expect(sql).not.toContain("user_metadata");
    expect(values).toEqual([SUPABASE_UUID]);
  });

  it("accepts camel-cased name claims", async () => {
    seed("provider-1", [
      {
        provider: "sso:provider-1",
        claims: { firstName: "Jane", lastName: "Doe" },
      },
    ]);

    const result = await getSsoClaimsForAuthUser(args);

    expect(result.firstName).toBe("Jane");
    expect(result.lastName).toBe("Doe");
    expect(result.groups).toEqual([]);
  });

  it("takes groups from the most recent identity of the bound provider", async () => {
    seed("provider-1", [
      {
        provider: "sso:provider-1",
        claims: { ...fullClaims, groups: ["new"] },
      },
      {
        provider: "sso:provider-1",
        claims: { ...fullClaims, groups: ["old"] },
      },
    ]);

    const result = await getSsoClaimsForAuthUser(args);

    expect(result.groups).toEqual(["new"]);
  });

  it("never takes groups from another provider's identity", async () => {
    seed("provider-1", [{ provider: "sso:other-tenant", claims: fullClaims }]);

    const result = await getSsoClaimsForAuthUser(args);

    expect(result.groups).toEqual([]);
    // Names and contact only edit the user's own profile, so they fall back.
    expect(result.firstName).toBe("Jane");
  });

  it("takes names from another SSO identity when the bound one has none, but no groups from it", async () => {
    seed("provider-1", [
      { provider: "sso:provider-1", claims: { groups: ["bound-group"] } },
      {
        provider: "sso:other-tenant",
        claims: { ...fullClaims, groups: ["x"] },
      },
    ]);

    const result = await getSsoClaimsForAuthUser(args);

    expect(result.groups).toEqual(["bound-group"]);
    expect(result.firstName).toBe("Jane");
    expect(result.lastName).toBe("Doe");
    expect(result.contactInfo?.city).toBe("Springfield");
  });

  it("returns no groups for a domain with no registered provider", async () => {
    seed(null, [{ provider: "sso:provider-1", claims: fullClaims }]);

    const result = await getSsoClaimsForAuthUser(args);

    expect(result.groups).toEqual([]);
    expect(result.firstName).toBe("Jane");
  });

  it("returns no names or contact info when no identity carries names", async () => {
    seed("provider-1", [
      { provider: "sso:provider-1", claims: { groups: ["admins"] } },
    ]);

    const result = await getSsoClaimsForAuthUser(args);

    expect(result).toEqual({
      groups: ["admins"],
      firstName: null,
      lastName: null,
      contactInfo: undefined,
    });
  });

  it("wraps a query failure in a ShelfError", async () => {
    queryRaw.mockRejectedValueOnce(new Error("db down"));

    await expect(getSsoClaimsForAuthUser(args)).rejects.toBeInstanceOf(
      ShelfError
    );
  });
});

describe("normalizeSsoGroups", () => {
  it.each([
    ["a list of names", ["a", "b"], ["a", "b"]],
    ["a single name", "a", ["a"]],
    ["a list with non-string entries", ["a", 1, null, { b: 1 }], ["a"]],
    ["null", null, []],
    ["a missing value", undefined, []],
    ["a number", 42, []],
    ["an object", { groups: ["a"] }, []],
  ])("normalises %s", (_label, value, expected) => {
    expect(normalizeSsoGroups(value)).toEqual(expected);
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
