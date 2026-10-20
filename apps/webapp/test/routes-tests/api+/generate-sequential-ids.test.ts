/**
 * The sequential-ID migration endpoint runs only for members who may edit
 * assets (`asset:update`), judged on this workspace's membership whatever the
 * order of its roles.
 *
 * @see {@link file://../../../app/routes/api+/generate-sequential-ids.tsx}
 */
import { createActionArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment node

const state = vi.hoisted(() => ({ roles: [] as string[] }));

// why: the organization context needs a session cookie and the database
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(async () => ({ organizationId: "org-1" })),
}));

// why: the membership read is database work; the test controls the roles the
// route sees for this workspace
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(async () => ({
    id: "user-1",
    userOrganizations: [{ roles: state.roles }],
  })),
}));

// why: marking the workspace migrated is a database write; only whether the
// migration ran matters here
vi.mock("~/modules/organization/service.server", () => ({
  updateOrganization: vi.fn(async () => ({})),
}));

// why: the permission check receives the roles and never reads the database,
// but the module imports the client; this keeps the test off a real connection
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the bulk generator rewrites every asset; only whether it ran matters here
vi.mock("~/modules/asset/sequential-id.server", () => ({
  generateBulkSequentialIdsEfficient: vi.fn(async () => 0),
}));

import { generateBulkSequentialIdsEfficient } from "~/modules/asset/sequential-id.server";
import { action } from "~/routes/api+/generate-sequential-ids";

/** Runs the action as a member holding `roles` in the selected workspace. */
async function run(roles: string[]) {
  state.roles = roles;
  return action(
    createActionArgs({
      request: new Request("http://localhost/api/generate-sequential-ids", {
        method: "POST",
      }),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  ) as unknown as Promise<{ init?: { status?: number } }>;
}

describe("POST /api/generate-sequential-ids", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [["OWNER"]],
    [["ADMIN"]],
    [["SELF_SERVICE", "ADMIN"]],
    [["BASE", "OWNER"]],
  ])("runs for %j", async (roles) => {
    await run(roles);
    expect(generateBulkSequentialIdsEfficient).toHaveBeenCalled();
  });

  it.each([[["SELF_SERVICE"]], [["BASE"]], [["SELF_SERVICE", "BASE"]], [[]]])(
    "refuses %j",
    async (roles) => {
      const res = await run(roles);
      expect(res.init?.status).toBe(403);
      expect(generateBulkSequentialIdsEfficient).not.toHaveBeenCalled();
    }
  );
});
