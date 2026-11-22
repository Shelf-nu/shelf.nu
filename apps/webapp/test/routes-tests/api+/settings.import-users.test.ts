/**
 * Bulk user invite (CSV import) route
 *
 * Pins how the route hands an uploaded file to `bulkInviteUsers` and answers
 * with what it decides. Row validation (roles, emails, team members, SSO)
 * lives in the service's pre-flight and is covered there, including the
 * OWNER-escalation guard (detail.dev finding D032).
 *
 * @see {@link file://./../../../app/routes/api+/settings.import-users.ts}
 * @see {@link file://./../../../app/modules/invite/import-users-preflight.server.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import type { AppLoadContext } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { bulkInviteUsers } from "~/modules/invite/service.server";
import { action } from "~/routes/api+/settings.import-users";
import type { CSVData } from "~/utils/csv.server";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";

// @vitest-environment node

// why: the route parses an uploaded file; we drive rows in directly instead
vi.mock("~/utils/csv.server", () => ({ csvDataFromRequest: vi.fn() }));

// why: authorization is not under test here
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: subscription seat limits are a separate concern from the import
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanInviteUsersToWorkspace: vi.fn(),
}));

// why: the invite service sends email and writes to the database; its row
// validation has its own suite
vi.mock("~/modules/invite/service.server", () => ({
  bulkInviteUsers: vi.fn(),
}));

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  setSession: vi.fn(),
  destroySession: vi.fn(),
  commitSession: vi.fn(),
  isAuthenticated: true,
  appVersion: "test",
} as unknown as AppLoadContext;

/** One CSV row: role, email, teamMemberId — matching IMPORT_USERS_CSV_HEADERS */
type CsvRow = [string, string, string];

/** Builds the raw CSV grid `csvDataFromRequest` would return */
function csvRows(rows: CsvRow[]): CSVData {
  return [["role", "email", "teamMemberId"], ...rows];
}

/**
 * The action funnels thrown ShelfErrors through `data(error(reason), { status })`,
 * which returns a DataWithResponseInit rather than a Response. `data` stays
 * `unknown` because its shape differs between the success and error branches.
 */
type ActionResult = { init?: { status?: number }; data?: unknown };

async function runImport(rows: CsvRow[]): Promise<ActionResult> {
  vi.mocked(csvDataFromRequest).mockResolvedValue(csvRows(rows));

  const request = new Request("http://localhost/api/settings/import-users", {
    method: "POST",
    body: new URLSearchParams({ message: "" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return (await action(
    createActionArgs({ context: mockContext, request, params: {} })
  )) as ActionResult;
}

describe("settings.import-users", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // An Administrator acting, unless a case says otherwise. The rest of the
    // permission payload is irrelevant here, so it is cast to the real return
    // type rather than reconstructed field by field.
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.ADMIN] }) as Awaited<
        ReturnType<typeof requirePermission>
      >
    );
    vi.mocked(assertUserCanInviteUsersToWorkspace).mockResolvedValue(undefined);
    vi.mocked(bulkInviteUsers).mockResolvedValue(
      {} as Awaited<ReturnType<typeof bulkInviteUsers>>
    );
  });

  it("hands every row to the service, which validates them", async () => {
    await runImport([
      [OrganizationRoles.ADMIN, "a@example.com", ""],
      [OrganizationRoles.OWNER, "b@example.com", "tm-1"],
    ]);

    expect(bulkInviteUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        users: [
          expect.objectContaining({ role: "ADMIN", email: "a@example.com" }),
          expect.objectContaining({
            role: "OWNER",
            email: "b@example.com",
            teamMemberId: "tm-1",
          }),
        ],
      })
    );
  });

  it.each([
    [OrganizationRoles.ADMIN, false],
    [OrganizationRoles.OWNER, true],
  ])(
    "tells the service whether a %s caller owns the workspace",
    async (role, ownsWorkspace) => {
      vi.mocked(requirePermission).mockResolvedValue(
        permissionContext({ roles: [role] }) as Awaited<
          ReturnType<typeof requirePermission>
        >
      );

      await runImport([[OrganizationRoles.BASE, "a@example.com", ""]]);

      // The service refuses an owner-only role unless the caller owns the
      // workspace, so this flag is what stands between an admin and it.
      expect(bulkInviteUsers).toHaveBeenCalledWith(
        expect.objectContaining({ actorOwnsWorkspace: ownsWorkspace })
      );
    }
  );

  it("answers a refused file with a 400 carrying the row errors", async () => {
    const rowErrors = [
      { row: 3, title: "Invalid role", message: "OWNER can't be granted." },
    ];
    vi.mocked(bulkInviteUsers).mockRejectedValue(
      new ShelfError({
        cause: null,
        title: "Import file has errors",
        message: "Found 1 problem(s) in your file. Nothing was imported.",
        additionalData: { rowErrors, totalErrors: 1 },
        label: "Invite",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await runImport([
      [OrganizationRoles.OWNER, "attacker@example.com", ""],
    ]);

    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({
      error: { additionalData: { rowErrors, totalErrors: 1 } },
    });
  });

  it("refuses an empty file as a client error", async () => {
    vi.mocked(csvDataFromRequest).mockResolvedValue([
      ["role", "email", "teamMemberId"],
    ]);
    const request = new Request("http://localhost/api/settings/import-users", {
      method: "POST",
      body: new URLSearchParams({ message: "" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const response = (await action(
      createActionArgs({ context: mockContext, request, params: {} })
    )) as ActionResult;

    expect(response.init?.status).toBe(400);
    expect(bulkInviteUsers).not.toHaveBeenCalled();
  });

  it("lets an ADMIN import non-owner-only roles", async () => {
    const response = await runImport([
      [OrganizationRoles.BASE, "b@example.com", ""],
      [OrganizationRoles.SELF_SERVICE, "c@example.com", ""],
    ]);

    expect(response.init?.status).toBeUndefined();
    expect(bulkInviteUsers).toHaveBeenCalledTimes(1);
  });
});
