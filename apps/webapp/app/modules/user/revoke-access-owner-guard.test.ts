/**
 * revokeAccessToOrganization — owner protection
 *
 * A workspace must always have an owner, and revoking is a one-way door: it
 * deletes the target's `UserOrganization` row, which is exactly the record
 * `transferOwnership` looks up to hand ownership on. Revoke the owner and the
 * workspace cannot be recovered through the UI — `Organization.userId` still
 * names them, but with no membership they get a 403 and every transfer path
 * fails.
 *
 * The guard lives in the service rather than at a call site so it holds for
 * every caller, including SCIM deprovisioning.
 *
 * Regression coverage for detail.dev finding D058.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./utils.server.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { revokeAccessToOrganization } from "./service.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  userOrganization: { findFirst: vi.fn() },
  teamMember: { findFirst: vi.fn() },
  user: { update: vi.fn() },
  $executeRaw: vi.fn(),
}));

// why: isolating the guard from the database; the assertion is that the
// destructive write never happens
vi.mock("~/database/db.server", () => ({ db: dbMock }));

describe("revokeAccessToOrganization — owner protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.teamMember.findFirst.mockResolvedValue({ id: "tm-1" });
    dbMock.user.update.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    });
    dbMock.$executeRaw.mockResolvedValue(0);
  });

  it("refuses to revoke the workspace owner", async () => {
    dbMock.userOrganization.findFirst.mockResolvedValue({
      roles: [OrganizationRoles.OWNER],
    });

    await expect(
      revokeAccessToOrganization({
        userId: "owner-user",
        organizationId: "org-1",
      })
    ).rejects.toThrow(/transfer ownership/i);

    // Deleting the membership is the irreversible step — it must not run
    expect(dbMock.user.update).not.toHaveBeenCalled();
  });

  it("still revokes a non-owner", async () => {
    dbMock.userOrganization.findFirst.mockResolvedValue({
      roles: [OrganizationRoles.ADMIN],
    });

    await revokeAccessToOrganization({
      userId: "admin-user",
      organizationId: "org-1",
    });

    expect(dbMock.user.update).toHaveBeenCalled();
  });

  it("still revokes a user whose membership row is missing", async () => {
    // Defensive: a missing row must not become a silent block on revocation
    dbMock.userOrganization.findFirst.mockResolvedValue(null);

    await revokeAccessToOrganization({
      userId: "ghost-user",
      organizationId: "org-1",
    });

    expect(dbMock.user.update).toHaveBeenCalled();
  });
});
