/**
 * NRM edit route: gated on nonRegisteredMember:update and delegating to the
 * scoped service for both the read and the write.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.team.nrm.$nrmId.edit.tsx}
 * @see {@link file://../../../app/modules/team-member/rename-nrm.test.ts} the scope itself
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { getNrmForEdit, renameNrm } from "~/modules/team-member/service.server";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: the gate is observed, not executed; the matrix has its own tests
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: the scoped read and write are tested next to the service; here they
// are the boundary the route must delegate to
vi.mock("~/modules/team-member/service.server", () => ({
  getNrmForEdit: vi.fn(async () => ({ id: "nrm-1", name: "Old" })),
  renameNrm: vi.fn(async () => undefined),
}));

// why: importing the route reaches the Prisma client, which connects at import
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the success toast goes through the notification emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const { action, loader } = await import(
  "~/routes/_layout+/settings.team.nrm.$nrmId.edit"
);

const ctx = { getSession: () => ({ userId: "user-1" }) } as never;

/** The 404 the scoped service answers for an id outside the NRM scope. */
function notFound() {
  return new ShelfError({
    cause: null,
    message: "Not found",
    status: 404,
    label: "Team Member",
    shouldBeCaptured: false,
  });
}

/**
 * Posts a rename.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function submitRename(nrmId: string, name: string) {
  return action(
    createActionArgs({
      params: { nrmId },
      context: ctx,
      request: new Request(`http://localhost/settings/team/nrm/${nrmId}/edit`, {
        method: "POST",
        body: new URLSearchParams({ name }),
      }),
    })
  );
}

describe("NRM edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loader: gates on nonRegisteredMember:update and reads through the scoped service", async () => {
    await loader(
      createLoaderArgs({ params: { nrmId: "nrm-1" }, context: ctx })
    );

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.nonRegisteredMember,
        action: PermissionAction.update,
      })
    );
    expect(getNrmForEdit).toHaveBeenCalledWith({
      nrmId: "nrm-1",
      organizationId: "org-1",
    });
  });

  it("loader: an id outside the NRM scope is a 404", async () => {
    vi.mocked(getNrmForEdit).mockRejectedValueOnce(notFound());

    await expect(
      loader(
        createLoaderArgs({ params: { nrmId: "registered" }, context: ctx })
      )
    ).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("action: gates on nonRegisteredMember:update", async () => {
    await submitRename("nrm-1", "New");

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.nonRegisteredMember,
        action: PermissionAction.update,
      })
    );
  });

  it("action: writes through the scoped rename with the session's organization", async () => {
    await submitRename("nrm-1", "  New  ");

    expect(renameNrm).toHaveBeenCalledWith({
      nrmId: "nrm-1",
      organizationId: "org-1",
      name: "New",
    });
  });

  it("action: an id outside the NRM scope is a 404", async () => {
    vi.mocked(renameNrm).mockRejectedValueOnce(notFound());

    const res = await submitRename("registered", "New");

    assertIsDataWithResponseInit(res);
    expect(res.init?.status).toBe(404);
  });
});
