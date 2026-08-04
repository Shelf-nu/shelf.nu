// @vitest-environment node
/**
 * Server-side authorization test for the audit activity (notes) loader.
 *
 * Same shape as the asset activity gap: the loader gated on `audit:read` and
 * returned the audit's notes, leaving `auditNote:read` to a check in the
 * component. Unlike the asset case this is not a live exposure — every role
 * currently holds `auditNote:read` (asserted below, so the day that changes
 * these tests speak up) — but the gate belongs on the server either way.
 *
 * @see {@link file://./audits.$auditId.activity.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
  Role2PermissionMap,
} from "~/utils/permissions/permission.data";

const {
  getAuditNotes,
  getAuditSessionDetails,
  requireAuditAssigneeForBaseSelfService,
  requirePermission,
} = vi.hoisted(() => ({
  getAuditNotes: vi.fn(),
  getAuditSessionDetails: vi.fn(),
  requireAuditAssigneeForBaseSelfService: vi.fn(),
  requirePermission: vi.fn(),
}));

// why: the loader's authorization call — the subject of these tests.
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: DB reads. We assert on WHETHER the note read runs, not its contents.
vi.mock("~/modules/audit/note-service.server", () => ({ getAuditNotes }));
vi.mock("~/modules/audit/service.server", () => ({
  getAuditSessionDetails,
  requireAuditAssigneeForBaseSelfService,
}));

import { loader } from "./audits.$auditId.activity";

/** Minimal loader args for `/audits/audit-1/activity`. */
function loaderArgs() {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request("http://localhost/audits/audit-1/activity"),
    params: { auditId: "audit-1" },
  } as unknown as Parameters<typeof loader>[0];
}

describe("audit activity loader — auditNote:read is enforced server-side", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuditSessionDetails.mockResolvedValue({
      session: { id: "audit-1", name: "Q3 sweep" },
    });
    getAuditNotes.mockResolvedValue([
      { id: "note-1", content: "Two units missing from bay 4" },
    ]);
  });

  it("asks for auditNote:read, not audit:read", async () => {
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [],
      isSelfServiceOrBase: false,
    });

    await loader(loaderArgs());

    // The parent route already enforces `audit:read`; this child must require
    // the permission covering the data it returns.
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.auditNote,
        action: PermissionAction.read,
      })
    );
  });

  it("never reads a note when auditNote:read is refused", async () => {
    // Simulates a role without `auditNote:read`. No such role exists today
    // (see the matrix assertion below), which is precisely why the client-side
    // check looked harmless — the gate has to hold on its own terms, not on
    // today's matrix happening to be permissive.
    requirePermission.mockImplementation(
      ({ entity }: { entity: PermissionEntity }) => {
        if (entity === PermissionEntity.auditNote) {
          // why: a real `ShelfError` — the shape `validatePermission` throws.
          // The loader's `makeShelfError` only preserves the 403 for a
          // ShelfError; a bare Error becomes a generic 500, which would let
          // the assertion below pass against the wrong status.
          return Promise.reject(
            new ShelfError({
              cause: null,
              title: "Unauthorized",
              message: "You have no permission to perform this action",
              status: 403,
              label: "Permission",
              shouldBeCaptured: false,
            })
          );
        }
        return Promise.resolve({
          organizationId: "org-1",
          userOrganizations: [],
          isSelfServiceOrBase: false,
        });
      }
    );

    // Assert the denial is specifically a 403, not merely "something threw".
    const thrown = await loader(loaderArgs()).then(
      () => null,
      (caught: unknown) => caught
    );

    expect((thrown as { init?: { status?: number } })?.init?.status).toBe(403);

    expect(getAuditNotes).not.toHaveBeenCalled();
  });

  it("keeps the assignee restriction for BASE/SELF_SERVICE", async () => {
    // Switching the gated entity must not drop the orthogonal check that stops
    // a BASE/SELF_SERVICE user reading an audit they are not assigned to.
    requirePermission.mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [],
      isSelfServiceOrBase: true,
    });

    await loader(loaderArgs());

    expect(requireAuditAssigneeForBaseSelfService).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        isSelfServiceOrBase: true,
        auditId: "audit-1",
      })
    );
  });

  it("documents that every role currently holds auditNote:read", () => {
    // ADMIN/OWNER short-circuit to allow-all server-side, so only the two
    // restricted roles need the explicit grant. If this ever changes, the gate
    // above is what stops the notes leaking.
    for (const role of [
      OrganizationRoles.BASE,
      OrganizationRoles.SELF_SERVICE,
    ]) {
      expect(Role2PermissionMap[role]?.[PermissionEntity.auditNote]).toContain(
        PermissionAction.read
      );
    }
  });
});
