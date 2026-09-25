/**
 * Bulk user invite (CSV import): role validation
 *
 * Pins that the CSV import cannot grant a role the invite dialog refuses, and
 * that only the workspace owner can grant an owner-only role through it. The
 * `role` column is raw text from an uploaded file and flows into `Invite.roles`
 * verbatim; after acceptance, permissions resolve from `UserOrganization.roles`,
 * so an unvalidated `OWNER` there is a full privilege escalation.
 *
 * @see {@link file://./../../../app/routes/api+/settings.import-users.ts}
 * @see {@link file://./../../../app/modules/invite/roles.ts}
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
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";

// @vitest-environment node

// why: the route parses an uploaded file; we drive rows in directly instead
vi.mock("~/utils/csv.server", () => ({ csvDataFromRequest: vi.fn() }));

// why: the permission lookup reads the database; each case supplies the
// resolved access of the acting member instead
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: subscription seat limits are a separate concern from role validation
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanInviteUsersToWorkspace: vi.fn(),
}));

// why: the invite service sends email and writes to the database
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

describe("settings.import-users role validation", () => {
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

  it("rejects a CSV row granting OWNER", async () => {
    const response = await runImport([
      [OrganizationRoles.OWNER, "attacker@example.com", ""],
    ]);

    expect(response.init?.status).toBe(400);
    // The invite must never be created — this is the escalation itself
    expect(bulkInviteUsers).not.toHaveBeenCalled();
  });

  it("names the offending spreadsheet row so the admin can fix it", async () => {
    const response = await runImport([
      [OrganizationRoles.ADMIN, "fine@example.com", ""],
      [OrganizationRoles.OWNER, "attacker@example.com", ""],
    ]);

    // Data row 2 is spreadsheet row 3 (header + 1-based)
    expect(JSON.stringify(response.data)).toContain("row 3");
  });

  it("rejects an unknown role rather than passing it to Prisma", async () => {
    const response = await runImport([["SUPERUSER", "x@example.com", ""]]);

    expect(response.init?.status).toBe(400);
    expect(bulkInviteUsers).not.toHaveBeenCalled();
  });

  it("still accepts the three invitable roles from the owner", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(
      permissionContext({ roles: [OrganizationRoles.OWNER] }) as Awaited<
        ReturnType<typeof requirePermission>
      >
    );

    const response = await runImport([
      [OrganizationRoles.ADMIN, "a@example.com", ""],
      [OrganizationRoles.BASE, "b@example.com", ""],
      [OrganizationRoles.SELF_SERVICE, "c@example.com", ""],
    ]);

    expect(response.init?.status).toBeUndefined();
    expect(bulkInviteUsers).toHaveBeenCalledTimes(1);
  });

  it("refuses an ADMIN importing an ADMIN row and creates no invites", async () => {
    const response = await runImport([
      [OrganizationRoles.BASE, "fine@example.com", ""],
      [OrganizationRoles.ADMIN, "admin@example.com", ""],
    ]);

    expect(response.init?.status).toBe(403);
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

  it("passes the actor's ownership to the service", async () => {
    await runImport([[OrganizationRoles.BASE, "b@example.com", ""]]);

    expect(bulkInviteUsers).toHaveBeenCalledWith(
      expect.objectContaining({ actorOwnsWorkspace: false })
    );
  });
});
