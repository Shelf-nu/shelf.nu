/**
 * Pending-invites page: gated on the invite permission and sending the client
 * only what the page renders.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.team.invites.tsx}
 */
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { db } from "~/database/db.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: the gate is observed, not executed; the matrix has its own tests
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: the organization read is the boundary under test; its query shape is asserted
vi.mock("~/database/db.server", () => ({
  db: {
    organization: {
      findFirst: vi.fn(async () => ({
        id: "org-1",
        name: "Org",
        type: "TEAM",
        owner: { email: "o@x.io" },
      })),
    },
  },
}));

// why: the invite list is a paginated query tested with its service
vi.mock("~/modules/invite/service.server", () => ({
  getPaginatedAndFilterableSettingInvites: vi.fn(async () => ({
    page: 1,
    perPage: 20,
    search: null,
    items: [],
    totalItems: 0,
    totalPages: 0,
  })),
}));

const { loader } = await import("~/routes/_layout+/settings.team.invites");

const run = () =>
  loader(
    createLoaderArgs({
      context: { getSession: () => ({ userId: "u" }) } as never,
    })
  );

describe("settings.team.invites loader", () => {
  it("is gated on the invite permission (teamMember:create)", async () => {
    await run();

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.teamMember,
        action: PermissionAction.create,
      })
    );
  });

  it("selects only the organization fields the page needs, never the owner's full user row", async () => {
    await run();

    expect(vi.mocked(db.organization.findFirst)).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: {
        id: true,
        name: true,
        type: true,
        owner: { select: { email: true } },
      },
    });
  });
});
