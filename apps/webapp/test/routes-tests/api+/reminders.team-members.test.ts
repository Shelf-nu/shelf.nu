// @vitest-environment node
/**
 * The reminder recipient picker serves the set and edit reminder dialogs, so
 * either reminder permission opens it, and it fetches only what the picker
 * renders. Its candidates are the members whose role may be picked as a
 * recipient (`notifications.selectableAsRecipient`), not a hand-listed role
 * pair.
 *
 * @see {@link file://../../../app/routes/api+/reminders.team-members.ts}
 * @see {@link file://../../../app/components/asset-reminder/team-members-selector.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { db } from "~/database/db.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requireAnyPermission } from "~/utils/roles.server";

// why: only the gate is under test, so it is observed rather than executed
vi.mock("~/utils/roles.server", () => ({
  requireAnyPermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: the query shape is asserted, not run against a database
vi.mock("~/database/db.server", () => ({
  db: { teamMember: { findMany: vi.fn(async () => []) } },
}));

const { loader } = await import("~/routes/api+/reminders.team-members");

/** Loads the picker's candidates as `user-1`. */
function load() {
  return loader(
    createLoaderArgs({
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/api/reminders/team-members"),
    })
  );
}

describe("reminder recipient picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens for either assetReminders:create or assetReminders:update", async () => {
    await load();

    expect(requireAnyPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        anyOf: [
          {
            entity: PermissionEntity.assetReminders,
            action: PermissionAction.create,
          },
          {
            entity: PermissionEntity.assetReminders,
            action: PermissionAction.update,
          },
        ],
      })
    );
  });

  it("scopes candidates to the caller's workspace and skips their custodies", async () => {
    await load();

    const [args] = vi.mocked(db.teamMember.findMany).mock
      .calls[0] as unknown as [
      { where: { organizationId: string }; include: Record<string, unknown> },
    ];
    expect(args.where.organizationId).toBe("org-1");
    expect(args.include).toHaveProperty("user");
    expect(args.include).not.toHaveProperty("custodies");
  });

  it("offers members whose role may be picked as a recipient", async () => {
    await load();

    const [args] = vi.mocked(db.teamMember.findMany).mock
      .calls[0] as unknown as [{ where: unknown }];
    expect(JSON.stringify(args.where)).toContain('"hasSome":["OWNER","ADMIN"]');
  });
});
