/**
 * Unit tests for SSO group→role resolution.
 *
 * `getRoleFromGroupId` maps the SAML `groups` claim (an array of strings) to a
 * Shelf `OrganizationRoles` value, using the group ids configured on `SsoDetails`.
 * These tests lock the robustness needed for real-world IdPs (esp. Shibboleth):
 * comma-separated multi-value fields, whitespace trimming, and case-insensitive
 * matching — while preserving ADMIN > SELF_SERVICE > BASE precedence.
 *
 * @see {@link file://./roles.server.ts}
 */
import type { SsoDetails } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  getRoleFromGroupId,
  resolveCanSeeAllCustody,
  resolveEffectiveRole,
} from "./roles.server";

// why: roles.server.ts imports ~/database/db.server, whose non-production branch
// eagerly runs `void db.$connect()` at import time. With the placeholder test
// DATABASE_URL that connect rejects, surfacing as an unhandled rejection in the
// run. getRoleFromGroupId never touches the db, so we stub the module out entirely
// (same pattern as modules/auth/mobile-sso.server.test.ts).
vi.mock("~/database/db.server", () => ({ db: {} }));

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

/**
 * Custody read-visibility rule.
 *
 * `requirePermission` computed this inline, so `/api/model-filters` had no way
 * to resolve it identically — which is how the custodian picker's search ended
 * up ignoring the scoping every seeding loader applies. Extracted so there is
 * exactly one definition.
 *
 * The two workspace overrides are independent and must not leak into each
 * other: enabling custody visibility for self-service users says nothing about
 * base users.
 */
describe("resolveCanSeeAllCustody", () => {
  /** Workspace with both overrides off unless stated. */
  const org = (over: Partial<Record<string, boolean>> = {}) => ({
    selfServiceCanSeeCustody: false,
    baseUserCanSeeCustody: false,
    ...over,
  });

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "always true for %s",
    (role) => {
      expect(
        resolveCanSeeAllCustody({ role, currentOrganization: org() })
      ).toBe(true);
    }
  );

  it("honours selfServiceCanSeeCustody", () => {
    const role = OrganizationRoles.SELF_SERVICE;
    expect(resolveCanSeeAllCustody({ role, currentOrganization: org() })).toBe(
      false
    );
    expect(
      resolveCanSeeAllCustody({
        role,
        currentOrganization: org({ selfServiceCanSeeCustody: true }),
      })
    ).toBe(true);
  });

  it("honours baseUserCanSeeCustody", () => {
    const role = OrganizationRoles.BASE;
    expect(resolveCanSeeAllCustody({ role, currentOrganization: org() })).toBe(
      false
    );
    expect(
      resolveCanSeeAllCustody({
        role,
        currentOrganization: org({ baseUserCanSeeCustody: true }),
      })
    ).toBe(true);
  });

  it("does not let one role's override leak to the other", () => {
    expect(
      resolveCanSeeAllCustody({
        role: OrganizationRoles.BASE,
        currentOrganization: org({ selfServiceCanSeeCustody: true }),
      })
    ).toBe(false);
    expect(
      resolveCanSeeAllCustody({
        role: OrganizationRoles.SELF_SERVICE,
        currentOrganization: org({ baseUserCanSeeCustody: true }),
      })
    ).toBe(false);
  });
});

describe("resolveEffectiveRole", () => {
  const membership = (roles: OrganizationRoles[]) => [
    { organization: { id: "org-1" }, roles },
  ];

  it("returns the most privileged role, not roles[0]", () => {
    // Both callers use this to decide how much a user may SEE — the custodian
    // picker's scope and booking visibility. Taking roles[0] handed an actual
    // admin the restricted view.
    expect(
      resolveEffectiveRole({
        userOrganizations: membership([
          OrganizationRoles.SELF_SERVICE,
          OrganizationRoles.ADMIN,
        ]),
        organizationId: "org-1",
      })
    ).toBe(OrganizationRoles.ADMIN);
  });

  it("prefers OWNER above all", () => {
    expect(
      resolveEffectiveRole({
        userOrganizations: membership([
          OrganizationRoles.BASE,
          OrganizationRoles.OWNER,
        ]),
        organizationId: "org-1",
      })
    ).toBe(OrganizationRoles.OWNER);
  });

  it("falls back to BASE when the user has no membership in that org", () => {
    // Fails closed: an unknown membership gets the narrowest role.
    expect(
      resolveEffectiveRole({
        userOrganizations: membership([OrganizationRoles.ADMIN]),
        organizationId: "another-org",
      })
    ).toBe(OrganizationRoles.BASE);
  });
});
