/**
 * Single invite route: pins that the route hands the actor's workspace
 * ownership to `createInvite`, which is where "only the workspace owner can
 * grant an owner-only role" is enforced for every invite writer.
 *
 * @see {@link file://./../../../app/routes/api+/settings.invite-user.ts}
 * @see {@link file://./../../../app/utils/permissions/role-assignment.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { createInvite } from "~/modules/invite/service.server";
import { action } from "~/routes/api+/settings.invite-user";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the permission lookup reads the database; each case supplies the
// resolved access so the route's hand-off to createInvite is what is observed
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: seat limits are a subscription concern unrelated to role assignment
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanInviteUsersToWorkspace: vi.fn(),
}));

// why: createInvite writes rows and sends email; its own owner-only role test
// lives in the service test file, so here only the arguments it receives matter
vi.mock("~/modules/invite/service.server", () => ({ createInvite: vi.fn() }));

// why: the route looks up pending invites before inviting
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: { findUnique: vi.fn().mockResolvedValue(null) },
    invite: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: success notifications are a side effect outside the contract under test
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const context = {
  getSession: () => ({ userId: "acting-user" }),
} as unknown as AppLoadContext;

/** The dialog's form post for one invite. */
function inviteRequest(role: string) {
  return new Request("http://localhost/api/settings/invite-user", {
    method: "POST",
    body: new URLSearchParams({ email: "new@example.com", role }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("settings.invite-user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createInvite).mockResolvedValue({ id: "invite-1" } as Awaited<
      ReturnType<typeof createInvite>
    >);
  });

  it.each([
    [[OrganizationRoles.ADMIN], false],
    [[OrganizationRoles.OWNER], true],
    [[OrganizationRoles.ADMIN, OrganizationRoles.OWNER], true],
  ])("passes actorOwnsWorkspace for %j", async (roles, owns) => {
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({ roles }) as Awaited<
        ReturnType<typeof requirePermission>
      >
    );

    await (action(
      createActionArgs({ context, request: inviteRequest("ADMIN"), params: {} })
    ) as unknown as Promise<Response>);

    expect(db.invite.findMany).toHaveBeenCalled();
    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        actorOwnsWorkspace: owns,
        roles: [OrganizationRoles.ADMIN],
      })
    );
  });

  it("refuses an Owner role before creating anything", async () => {
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.OWNER] }) as Awaited<
        ReturnType<typeof requirePermission>
      >
    );

    const result = (await (action(
      createActionArgs({ context, request: inviteRequest("OWNER"), params: {} })
    ) as unknown as Promise<Response>)) as unknown as {
      init?: { status?: number };
    };

    expect(result.init?.status).toBe(400);
    expect(createInvite).not.toHaveBeenCalled();
  });
});
