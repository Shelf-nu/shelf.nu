// @vitest-environment node
/**
 * The two reminder tables (an asset's reminders and the reminders index)
 * submit edits and deletes to their route's action. Each intent is gated on
 * its own `assetReminders` permission: editing needs `update`, deleting
 * needs `delete`.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.reminders.tsx}
 * @see {@link file://../../../app/routes/_layout+/reminders._index.tsx}
 * @see {@link file://../../../app/modules/asset-reminder/utils.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";
import { resolveRemindersActions } from "~/modules/asset-reminder/utils.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: only the gate is under test, so it is observed rather than executed
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: the routes' loaders read reminders from the database; nothing here
// reaches a delegate, so an empty client keeps the import off a database
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: edits and deletes are tested with the service; the intent-to-permission
// map and the intent reader stay real because they decide the gate
vi.mock("~/modules/asset-reminder/utils.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/asset-reminder/utils.server")
  >()),
  resolveRemindersActions: vi.fn(async () => new Response(null)),
}));

const assetRemindersRoute = await import(
  "~/routes/_layout+/assets.$assetId.reminders"
);
const remindersIndexRoute = await import("~/routes/_layout+/reminders._index");

/**
 * Submits `intent` to `action`.
 *
 * why: a `URLSearchParams` body rather than `FormData`, which happy-dom can
 * alter on the `Request` round-trip.
 */
function submit(
  action: (args: ActionFunctionArgs) => Promise<unknown>,
  intent: string
) {
  return action(
    createActionArgs({
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) } as never,
      request: new Request("http://localhost/reminders", {
        method: "POST",
        body: new URLSearchParams({ intent, id: "reminder-1" }),
      }),
    })
  );
}

describe.each([
  { name: "asset reminders", action: assetRemindersRoute.action },
  { name: "reminders index", action: remindersIndexRoute.action },
])("$name action gates", ({ action }) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("editing a reminder requires assetReminders:update", async () => {
    await submit(action, "edit-reminder");

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.assetReminders,
        action: PermissionAction.update,
      })
    );
    expect(resolveRemindersActions).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" })
    );
  });

  it("deleting a reminder requires assetReminders:delete", async () => {
    await submit(action, "delete-reminder");

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.assetReminders,
        action: PermissionAction.delete,
      })
    );
  });

  it("refuses an unknown intent before any gate or write", async () => {
    const response = await submit(action, "archive-reminder");

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(resolveRemindersActions).not.toHaveBeenCalled();
  });
});
