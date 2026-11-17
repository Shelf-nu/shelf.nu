/**
 * Tests for the custom OIDC login: which sessions count as an OIDC sign-in,
 * which claims are read from the stored identity, and how a login provisions
 * the user and resolves the workspaces of `OIDC_WORKSPACE_MAPPINGS`.
 *
 * @see {@link file://./oidc.server.ts}
 */
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "~/utils/env";
import { ShelfError } from "~/utils/error";
import type * as MappingsModule from "./oidc-workspace-mappings.server";

// why: isolate from Prisma. `$queryRaw` stands in for the auth.identities
// lookups (raw because the auth schema is outside Prisma's model set).
vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    organization: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

// why: pin the provider configuration so the assertions do not depend on the
// OIDC_* variables of the local environment.
vi.mock("~/utils/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  OIDC_PROVIDER: "custom:acme",
  OIDC_SCOPES: "openid profile email groups",
  OIDC_GROUPS_CLAIM: "groups",
  SERVER_URL: "https://shelf.example.com",
  SUPABASE_URL: "https://auth.example.com/",
}));

// why: the configuration is parsed from the environment when the module
// loads; the tests need a known set of workspaces. The role resolution stays
// real, because which role a login gets is what these tests pin.
vi.mock("./oidc-workspace-mappings.server", async (importOriginal) => ({
  ...(await importOriginal<typeof MappingsModule>()),
  oidcWorkspaceMappings: [
    {
      key: "it",
      name: "IT Department",
      currency: "EUR",
      roles: { ADMIN: ["it-admins"], BASE: ["staff"] },
    },
    { key: "events", name: "Events", roles: { SELF_SERVICE: ["staff"] } },
  ],
}));

// why: creating and updating users is covered by the user module's own tests;
// here we verify when the login hands off to it, and with what.
vi.mock("~/modules/user/service.server", () => ({
  createUser: vi.fn(),
  updateUserFromSSO: vi.fn(),
}));

// why: creating a workspace writes a dozen related rows; the tests only
// verify that the login asks for it, for whom, and under which key.
vi.mock("~/modules/organization/service.server", () => ({
  createOrganization: vi.fn(),
}));

// why: deleteAuthAccount calls Supabase Auth.
vi.mock("./service.server", () => ({ deleteAuthAccount: vi.fn() }));

const { db } = await import("~/database/db.server");
const { createUser, updateUserFromSSO } = await import(
  "~/modules/user/service.server"
);
const { createOrganization } = await import(
  "~/modules/organization/service.server"
);
const { deleteAuthAccount } = await import("./service.server");
const {
  getOidcAuthorizeUrl,
  getOidcClaimsForAuthUser,
  isOidcAuthenticatedSession,
  resolveUserAndOrgForOidcCallback,
} = await import("./oidc.server");

const AUTH_USER_ID = "8b0f1c1e-6a52-4b0c-9a65-3f6f2f1f0a11";

/**
 * An unsigned access token whose `amr` claim records `method`. Only the
 * payload is read, so the header and signature are placeholders.
 */
function accessTokenSignedInBy(method: string) {
  const claims = { amr: [{ method, timestamp: 1 }] };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

const authSession = {
  userId: AUTH_USER_ID,
  email: "jane@example.com",
  accessToken: accessTokenSignedInBy("oauth"),
  refreshToken: "refresh-token",
  expiresIn: 3600,
  expiresAt: 0,
};

/** The Shelf user as the callback reads it before syncing workspaces. */
const shelfUser = {
  id: AUTH_USER_ID,
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  displayName: null,
  sso: true,
  userOrganizations: [],
};

/** A workspace row managed by a mapping entry. */
function workspace(key: string) {
  return { id: `org-${key}`, name: key, oidcMappingKey: key };
}

/**
 * Seeds which mapped workspaces exist.
 *
 * @param keys - the mapping keys that already have a workspace
 */
function seedWorkspaces(...keys: string[]) {
  vi.mocked(db.organization.findUnique).mockImplementation(((args: {
    where: { oidcMappingKey: string };
  }) =>
    Promise.resolve(
      keys.includes(args.where.oidcMappingKey)
        ? workspace(args.where.oidcMappingKey)
        : null
    )) as never);
}

/** The `workspaceRoles` the login handed to `updateUserFromSSO`. */
function syncedWorkspaceRoles() {
  const [, , userData] = vi.mocked(updateUserFromSSO).mock.calls[0];
  return (userData.workspaceRoles ?? []).map(({ organization, role }) => ({
    id: organization.id,
    role,
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue(shelfUser as never);
  vi.mocked(updateUserFromSSO).mockResolvedValue({
    user: shelfUser,
    org: null,
    transitions: [],
  } as never);
});

describe("getOidcAuthorizeUrl", () => {
  it("points at Supabase's authorize endpoint for the provider", () => {
    const url = new URL(getOidcAuthorizeUrl());

    expect(url.origin + url.pathname).toBe(
      "https://auth.example.com/auth/v1/authorize"
    );
    expect(url.searchParams.get("provider")).toBe("custom:acme");
    expect(url.searchParams.get("scopes")).toBe("openid profile email groups");
    expect(url.searchParams.get("redirect_to")).toBe(
      "https://shelf.example.com/oauth/callback"
    );
  });

  it("lands the native-app flow on the mobile callback", () => {
    const url = new URL(getOidcAuthorizeUrl({ platform: "mobile" }));

    expect(url.searchParams.get("redirect_to")).toBe(
      "https://shelf.example.com/oauth/callback/mobile"
    );
  });
});

describe("isOidcAuthenticatedSession", () => {
  it("accepts an OAuth session whose user holds the provider's identity", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ held: true }]);

    await expect(isOidcAuthenticatedSession(authSession)).resolves.toBe(true);
  });

  it("refuses an OAuth session without an identity from the provider", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ held: false }]);

    await expect(isOidcAuthenticatedSession(authSession)).resolves.toBe(false);
  });

  it.each(["password", "otp", "magiclink", "sso/saml"])(
    "refuses a session signed in by %s without looking anything up",
    async (method) => {
      await expect(
        isOidcAuthenticatedSession({
          ...authSession,
          accessToken: accessTokenSignedInBy(method),
        })
      ).resolves.toBe(false);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    }
  );
});

describe("getOidcClaimsForAuthUser", () => {
  it("reads the names and the allowlisted groups claim", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      {
        claims: {
          given_name: "Jane",
          family_name: "Doe",
          custom_claims: { groups: ["it-admins", "staff"] },
        },
      },
    ]);

    await expect(getOidcClaimsForAuthUser(AUTH_USER_ID)).resolves.toEqual({
      groups: ["it-admins", "staff"],
      firstName: "Jane",
      lastName: "Doe",
    });
  });

  it("splits a full name when the provider sends no separate names", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { claims: { name: "Jane van der Doe" } },
    ]);

    await expect(getOidcClaimsForAuthUser(AUTH_USER_ID)).resolves.toEqual({
      groups: [],
      firstName: "Jane",
      lastName: "van der Doe",
    });
  });

  it("reports no names unless both are known", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ claims: { name: "Jane" } }]);

    await expect(getOidcClaimsForAuthUser(AUTH_USER_ID)).resolves.toEqual({
      groups: [],
      firstName: null,
      lastName: null,
    });
  });

  it("ignores a groups claim outside custom_claims", async () => {
    // A top-level claim is not something GoTrue wrote from the allowlist.
    vi.mocked(db.$queryRaw).mockResolvedValue([
      {
        claims: {
          given_name: "Jane",
          family_name: "Doe",
          groups: ["it-admins"],
        },
      },
    ]);

    const claims = await getOidcClaimsForAuthUser(AUTH_USER_ID);
    expect(claims.groups).toEqual([]);
  });
});

describe("resolveUserAndOrgForOidcCallback", () => {
  const input = {
    authSession,
    firstName: "Jane",
    lastName: "Doe",
    groups: ["staff"],
  };

  it("syncs a returning user's role in every existing mapped workspace", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: AUTH_USER_ID,
      deletedAt: null,
    } as never);
    seedWorkspaces("it", "events");

    await resolveUserAndOrgForOidcCallback(input);

    expect(createUser).not.toHaveBeenCalled();
    expect(syncedWorkspaceRoles()).toEqual([
      { id: "org-it", role: "BASE" },
      { id: "org-events", role: "SELF_SERVICE" },
    ]);
  });

  it("passes a workspace the groups no longer map to, so access is revoked", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: AUTH_USER_ID,
      deletedAt: null,
    } as never);
    seedWorkspaces("it", "events");

    await resolveUserAndOrgForOidcCallback({ ...input, groups: [] });

    expect(syncedWorkspaceRoles()).toEqual([
      { id: "org-it", role: null },
      { id: "org-events", role: null },
    ]);
  });

  it("creates a new user as an SSO account", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    seedWorkspaces("it");

    await resolveUserAndOrgForOidcCallback(input);

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: AUTH_USER_ID,
        email: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
        isSSO: true,
      })
    );
    expect(syncedWorkspaceRoles()).toEqual([{ id: "org-it", role: "BASE" }]);
  });

  it("refuses a new user the provider sent no name for", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findFirst).mockResolvedValue(null);

    await expect(
      resolveUserAndOrgForOidcCallback({
        ...input,
        firstName: null,
        lastName: null,
      })
    ).rejects.toMatchObject({ status: 400, title: "Missing name" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("refuses when another Shelf account already uses the email", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: "another-account",
    } as never);

    await expect(resolveUserAndOrgForOidcCallback(input)).rejects.toMatchObject(
      { status: 409 }
    );
    expect(createUser).not.toHaveBeenCalled();
    expect(updateUserFromSSO).not.toHaveBeenCalled();
  });

  it("refuses a deleted account", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: AUTH_USER_ID,
      deletedAt: new Date(),
    } as never);

    await expect(resolveUserAndOrgForOidcCallback(input)).rejects.toMatchObject(
      { status: 403 }
    );
    expect(updateUserFromSSO).not.toHaveBeenCalled();
  });

  it("removes the auth user when the Shelf user cannot be created", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findFirst).mockResolvedValue(null);
    vi.mocked(createUser).mockRejectedValue(new Error("insert failed"));

    await expect(
      resolveUserAndOrgForOidcCallback(input)
    ).rejects.toBeInstanceOf(ShelfError);
    expect(deleteAuthAccount).toHaveBeenCalledWith(AUTH_USER_ID);
  });

  describe("a mapped workspace that does not exist yet", () => {
    beforeEach(() => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        id: AUTH_USER_ID,
        deletedAt: null,
      } as never);
      seedWorkspaces();
    });

    it("is created by its first administrator, who owns it", async () => {
      vi.mocked(createOrganization).mockResolvedValue(workspace("it") as never);

      await resolveUserAndOrgForOidcCallback({
        ...input,
        groups: ["it-admins"],
      });

      expect(createOrganization).toHaveBeenCalledTimes(1);
      expect(createOrganization).toHaveBeenCalledWith({
        name: "IT Department",
        userId: AUTH_USER_ID,
        image: null,
        currency: "EUR",
        oidcMappingKey: "it",
      });
      expect(syncedWorkspaceRoles()).toEqual([{ id: "org-it", role: "ADMIN" }]);
    });

    it("is not created by a member who is not an administrator", async () => {
      await resolveUserAndOrgForOidcCallback(input);

      expect(createOrganization).not.toHaveBeenCalled();
      expect(syncedWorkspaceRoles()).toEqual([]);
    });

    it("is read back when another login created it at the same moment", async () => {
      vi.mocked(createOrganization).mockRejectedValue(
        new ShelfError({
          cause: new PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: "test",
          }),
          message: "Something went wrong while creating the organization.",
          label: "Organization",
        })
      );
      // Nothing on the first read, the winner's workspace on the second.
      vi.mocked(db.organization.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(workspace("it") as never)
        .mockResolvedValue(null);

      await resolveUserAndOrgForOidcCallback({
        ...input,
        groups: ["it-admins"],
      });

      expect(syncedWorkspaceRoles()).toEqual([{ id: "org-it", role: "ADMIN" }]);
    });
  });
});
