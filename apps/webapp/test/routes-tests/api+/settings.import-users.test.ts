/**
 * Bulk user invite (CSV import) — role validation
 *
 * Pins that the CSV import cannot grant a role the invite dialog refuses. The
 * `role` column is raw text from an uploaded file and flows into `Invite.roles`
 * verbatim; after acceptance, permissions resolve from `UserOrganization.roles`,
 * so an unvalidated `OWNER` there is a full privilege escalation.
 *
 * Regression coverage for detail.dev finding D032.
 *
 * @see {@link file://./../../../app/routes/api+/settings.import-users.ts}
 * @see {@link file://./../../../app/modules/invite/roles.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { bulkInviteUsers } from "~/modules/invite/service.server";
import { action } from "~/routes/api+/settings.import-users";
import { csvDataFromRequest } from "~/utils/csv.server";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanInviteUsersToWorkspace } from "~/utils/subscription.server";

// @vitest-environment node

// why: the route parses an uploaded file; we drive rows in directly instead
vi.mock("~/utils/csv.server", () => ({ csvDataFromRequest: vi.fn() }));

// why: authorization is not under test here — the role gate is
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
} as any;

/** Builds the raw CSV grid `csvDataFromRequest` would return */
function csvRows(rows: Array<[string, string, string]>) {
  return [["role", "email", "teamMemberId"], ...rows];
}

async function runImport(rows: Array<[string, string, string]>) {
  vi.mocked(csvDataFromRequest).mockResolvedValue(csvRows(rows) as any);

  const request = new Request("http://localhost/api/settings/import-users", {
    method: "POST",
    body: new URLSearchParams({ message: "" }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return (await action(
    createActionArgs({ context: mockContext, request, params: {} })
  )) as { init?: { status?: number }; data?: any };
}

describe("settings.import-users role validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
    } as any);
    vi.mocked(assertUserCanInviteUsersToWorkspace).mockResolvedValue(
      undefined as any
    );
    vi.mocked(bulkInviteUsers).mockResolvedValue({} as any);
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

  it("still accepts the three invitable roles", async () => {
    const response = await runImport([
      [OrganizationRoles.ADMIN, "a@example.com", ""],
      [OrganizationRoles.BASE, "b@example.com", ""],
      [OrganizationRoles.SELF_SERVICE, "c@example.com", ""],
    ]);

    expect(response.init?.status).toBeUndefined();
    expect(bulkInviteUsers).toHaveBeenCalledTimes(1);
  });
});
