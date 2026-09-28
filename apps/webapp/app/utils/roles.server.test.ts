/**
 * Unit tests for SSO group→role resolution.
 *
 * `getRoleFromGroupId` maps the SAML `groups` claim (an array of strings) to a
 * Shelf `OrganizationRoles` value, using the group ids configured on `SsoDetails`.
 * These tests lock the robustness needed for real-world IdPs (esp. Shibboleth):
 * comma-separated multi-value fields, whitespace trimming, and case-insensitive
 * matching — while preserving ADMIN > SELF_SERVICE > BASE precedence.
 *
 * Also covers `requirePermission`'s `access` field: the `RoleAccess` object
 * folds the membership's policy with the workspace's visibility toggles, so
 * every loader and action asks one object instead of re-deriving the same
 * decision per call site.
 *
 * And `requireAnyPermission`, the gate for layouts that open with any of
 * several permissions (Settings, Team).
 *
 * @see {@link file://./roles.server.ts}
 */
import type { SsoDetails } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { SSO_ASSIGNABLE_ROLES } from "~/utils/permissions/role-access";
import { SSO_GROUP_ROLE, hasSsoGroupMappings } from "~/utils/sso-group-roles";
import {
  getRoleFromGroupId,
  requireAnyPermission,
  requirePermission,
} from "./roles.server";

// why: roles.server.ts imports ~/database/db.server, whose non-production branch
// eagerly runs `void db.$connect()` at import time. With the placeholder test
// DATABASE_URL that connect rejects, surfacing as an unhandled rejection in the
// run. getRoleFromGroupId never touches the db, so we stub the module out entirely
// (same pattern as modules/auth/mobile-sso.server.test.ts).
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: requirePermission resolves the caller's memberships and the active
// workspace through getSelectedOrganization (cookie + db lookups); mocking it
// lets these tests hand it a membership shape directly.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
}));

// why: validatePermission is the matrix gate that runs before access is
// resolved. These tests exercise the access computation that follows it, so
// the gate is stubbed to always permit. `hasPermission` stays real: with the
// roles supplied it is a pure matrix lookup, which requireAnyPermission's
// refusal case depends on.
vi.mock(
  "~/utils/permissions/permission.validator.server",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    validatePermission: vi.fn().mockResolvedValue(true),
  })
);

// why: requirePermission tags the Sentry scope with the caller and the
// organization; no Sentry client exists under `pnpm test:run`.
vi.mock("@sentry/react-router", () => ({ setUser: vi.fn(), setTag: vi.fn() }));

/** Builds a minimal SsoDetails; only the three group-id fields are read by the resolver. */
function makeSso(overrides: Partial<SsoDetails>): SsoDetails {
  return {
    id: "sso-1",
    domain: "example.edu",
    baseUserGroupId: null,
    selfServiceGroupId: null,
    adminGroupId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("SSO group columns", () => {
  it("confer exactly the SSO-assignable roles, one column each", () => {
    expect(Object.values(SSO_GROUP_ROLE).sort()).toEqual(
      [...SSO_ASSIGNABLE_ROLES].sort()
    );
  });

  it("a workspace has group mappings when any column is set", () => {
    expect(
      hasSsoGroupMappings({
        adminGroupId: null,
        selfServiceGroupId: null,
        baseUserGroupId: null,
      })
    ).toBe(false);
    expect(
      hasSsoGroupMappings({
        adminGroupId: null,
        selfServiceGroupId: "g",
        baseUserGroupId: null,
      })
    ).toBe(true);
  });
});

describe("getRoleFromGroupId", () => {
  it("matches an exact single admin group", () => {
    const sso = makeSso({ adminGroupId: "shelf-admins" });
    expect(getRoleFromGroupId(sso, ["shelf-admins"])).toBe(
      OrganizationRoles.ADMIN
    );
  });

  it("matches case-insensitively", () => {
    const sso = makeSso({ adminGroupId: "Shelf-Admins" });
    expect(getRoleFromGroupId(sso, ["shelf-admins"])).toBe(
      OrganizationRoles.ADMIN
    );
  });

  it("trims surrounding whitespace on both sides", () => {
    const sso = makeSso({ selfServiceGroupId: "  self-service  " });
    expect(getRoleFromGroupId(sso, ["self-service"])).toBe(
      OrganizationRoles.SELF_SERVICE
    );
  });

  it("supports a comma-separated list of group ids for one role", () => {
    const sso = makeSso({
      adminGroupId: "it-admins, sys-admins , shelf-admins",
    });
    expect(getRoleFromGroupId(sso, ["sys-admins"])).toBe(
      OrganizationRoles.ADMIN
    );
  });

  it("matches a full LDAP DN as a single whole-field value", () => {
    const sso = makeSso({
      baseUserGroupId: "cn=shelf-base,ou=groups,dc=example,dc=edu",
    });
    expect(
      getRoleFromGroupId(sso, ["cn=shelf-base,ou=groups,dc=example,dc=edu"])
    ).toBe(OrganizationRoles.BASE);
  });

  it("does NOT match a bare DN component when the field is a full DN", () => {
    // A configured DN must match only as a whole; its components (dc=edu, ou=groups)
    // must never grant the role on their own.
    const sso = makeSso({
      adminGroupId: "cn=shelf-admins,ou=groups,dc=example,dc=edu",
    });
    expect(getRoleFromGroupId(sso, ["dc=edu"])).toBeNull();
    expect(getRoleFromGroupId(sso, ["ou=groups"])).toBeNull();
  });

  it("prioritizes ADMIN when the user is in both admin and self-service groups", () => {
    const sso = makeSso({
      adminGroupId: "shelf-admins",
      selfServiceGroupId: "shelf-users",
    });
    expect(getRoleFromGroupId(sso, ["shelf-users", "shelf-admins"])).toBe(
      OrganizationRoles.ADMIN
    );
  });

  it("resolves SELF_SERVICE when only that group is present", () => {
    const sso = makeSso({
      adminGroupId: "shelf-admins",
      selfServiceGroupId: "shelf-users",
    });
    expect(getRoleFromGroupId(sso, ["shelf-users"])).toBe(
      OrganizationRoles.SELF_SERVICE
    );
  });

  it("returns null when no configured group matches", () => {
    const sso = makeSso({ adminGroupId: "shelf-admins" });
    expect(getRoleFromGroupId(sso, ["some-other-group"])).toBeNull();
  });

  it("returns null when all group-id fields are null/empty", () => {
    const sso = makeSso({ adminGroupId: "", selfServiceGroupId: null });
    expect(getRoleFromGroupId(sso, ["anything"])).toBeNull();
  });

  it("returns null for an empty claim array", () => {
    const sso = makeSso({ adminGroupId: "shelf-admins" });
    expect(getRoleFromGroupId(sso, [])).toBeNull();
  });
});

describe("requirePermission: access", () => {
  const ORG_ID = "org-1";
  const getSelectedOrganizationMock = vi.mocked(getSelectedOrganization);

  /** Workspace with every visibility toggle off unless stated. */
  function workspace(overrides: Partial<Record<string, boolean>> = {}) {
    return {
      id: ORG_ID,
      barcodesEnabled: false,
      auditsEnabled: false,
      selfServiceCanSeeCustody: false,
      baseUserCanSeeCustody: false,
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
      ...overrides,
    };
  }

  /** Points getSelectedOrganization at a caller holding `roles` in ORG_ID. */
  function actAs(
    roles: OrganizationRoles[],
    workspaceOverrides: Partial<Record<string, boolean>> = {}
  ) {
    const currentOrganization = workspace(workspaceOverrides);
    getSelectedOrganizationMock.mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [currentOrganization],
      userOrganizations: [{ organization: { id: ORG_ID }, roles }],
      currentOrganization,
      cookieRefreshNeeded: false,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves access from the membership's highest role, not roles[0]", async () => {
    actAs([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);

    const result = await requirePermission({
      userId: "user-1",
      request: new Request("http://localhost/test"),
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    expect(result.access.role).toBe("ADMIN");
  });

  it("widens access.custody.seeAll when the matching workspace override is on", async () => {
    actAs([OrganizationRoles.BASE], { baseUserCanSeeCustody: true });

    const result = await requirePermission({
      userId: "user-1",
      request: new Request("http://localhost/test"),
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    expect(result.access.custody.seeAll).toBe(true);
  });
});

describe("requireAnyPermission", () => {
  const ORG_ID = "org-1";
  const getSelectedOrganizationMock = vi.mocked(getSelectedOrganization);

  /** Points getSelectedOrganization at a caller holding `roles` in ORG_ID. */
  function mockMembership(roles: OrganizationRoles[]) {
    const currentOrganization = {
      id: ORG_ID,
      type: "TEAM",
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
      selfServiceCanSeeCustody: false,
      baseUserCanSeeCustody: false,
      barcodesEnabled: false,
      auditsEnabled: false,
    };
    getSelectedOrganizationMock.mockResolvedValue({
      organizationId: ORG_ID,
      userOrganizations: [{ organization: { id: ORG_ID }, roles }],
      organizations: [],
      currentOrganization,
      cookieRefreshNeeded: false,
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when any listed permission is held and returns the membership roles", async () => {
    mockMembership([OrganizationRoles.ADMIN]);

    const result = await requireAnyPermission({
      userId: "user-1",
      request: new Request("http://localhost/settings"),
      anyOf: [
        {
          entity: PermissionEntity.generalSettings,
          action: PermissionAction.read,
        },
        { entity: PermissionEntity.teamMember, action: PermissionAction.read },
      ],
    });

    expect(result.roles).toEqual(["ADMIN"]);
    expect(result.organizationId).toBe(ORG_ID);
  });

  it("refuses with 403 when none is held", async () => {
    mockMembership([OrganizationRoles.BASE]);

    await expect(
      requireAnyPermission({
        userId: "user-1",
        request: new Request("http://localhost/settings"),
        anyOf: [
          {
            entity: PermissionEntity.generalSettings,
            action: PermissionAction.read,
          },
        ],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("refuses an empty membership", async () => {
    mockMembership([]);

    await expect(
      requireAnyPermission({
        userId: "user-1",
        request: new Request("http://localhost/settings"),
        anyOf: [
          {
            entity: PermissionEntity.generalSettings,
            action: PermissionAction.read,
          },
        ],
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
