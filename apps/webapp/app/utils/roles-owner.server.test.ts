/**
 * Workspace-owner assertion.
 *
 * `requirePermission(subscription, update)` is not a sufficient gate for
 * anything that spends money or burns a one-time entitlement: ADMIN
 * short-circuits to allow-all in `hasPermission`, so it clears that check.
 * The add-on purchase UI is owner-only (`if (!isOwner) return null`), but the
 * actions behind it were not — so an ADMIN could burn the workspace's single
 * free trial, an irreversible flag, and commit the workspace to a charge on the
 * owner's card.
 *
 * detail.dev finding D102.
 *
 * @see {@link file://./roles.server.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// why: roles.server imports the Prisma client and Sentry at module load
vi.mock("~/database/db.server", () => ({ db: {} }));
vi.mock("@sentry/react-router", () => ({ setUser: vi.fn(), setTag: vi.fn() }));

import { assertIsOrganizationOwner, isOrganizationOwner } from "./roles.server";

// @vitest-environment node

const ORG = "org-1";

/** Builds a membership list granting `roles` in ORG. */
function memberships(roles: OrganizationRoles[]) {
  return [
    { organization: { id: "other-org" }, roles: [OrganizationRoles.OWNER] },
    { organization: { id: ORG }, roles },
  ];
}

describe("isOrganizationOwner", () => {
  it("recognises the owner", () => {
    expect(
      isOrganizationOwner({
        userOrganizations: memberships([OrganizationRoles.OWNER]),
        organizationId: ORG,
      })
    ).toBe(true);
  });

  it("does not treat ADMIN as owner", () => {
    expect(
      isOrganizationOwner({
        userOrganizations: memberships([OrganizationRoles.ADMIN]),
        organizationId: ORG,
      })
    ).toBe(false);
  });

  it("finds OWNER anywhere in the roles array, not just first", () => {
    // `resolveEffectiveRole` returns roles[0], so a check built on it would
    // miss an owner who also carries another role.
    expect(
      isOrganizationOwner({
        userOrganizations: memberships([
          OrganizationRoles.ADMIN,
          OrganizationRoles.OWNER,
        ]),
        organizationId: ORG,
      })
    ).toBe(true);
  });

  it("does not leak ownership of a DIFFERENT workspace", () => {
    // The fixture makes the caller OWNER of "other-org"; that must not count.
    expect(
      isOrganizationOwner({
        userOrganizations: memberships([OrganizationRoles.ADMIN]),
        organizationId: ORG,
      })
    ).toBe(false);
  });

  it("returns false when the caller has no membership at all", () => {
    expect(
      isOrganizationOwner({ userOrganizations: [], organizationId: ORG })
    ).toBe(false);
  });
});

describe("assertIsOrganizationOwner", () => {
  it("passes for the owner", () => {
    expect(() =>
      assertIsOrganizationOwner({
        userOrganizations: memberships([OrganizationRoles.OWNER]),
        organizationId: ORG,
        action: "start the trial",
      })
    ).not.toThrow();
  });

  it("throws 403 for an ADMIN", () => {
    expect(() =>
      assertIsOrganizationOwner({
        userOrganizations: memberships([OrganizationRoles.ADMIN]),
        organizationId: ORG,
        action: "start the trial",
      })
    ).toThrow(expect.objectContaining({ status: 403 }) as unknown as Error);
  });

  it("names the action in the message", () => {
    try {
      assertIsOrganizationOwner({
        userOrganizations: memberships([OrganizationRoles.BASE]),
        organizationId: ORG,
        action: "start or buy the audits add-on",
      });
      expect.unreachable("should have thrown");
    } catch (cause) {
      expect((cause as Error).message).toBe(
        "Only the workspace owner can start or buy the audits add-on."
      );
    }
  });
});
