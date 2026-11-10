// @vitest-environment node
/**
 * `GET /api/audits/get-pending`: the pending audits behind the bulk
 * "Add to existing audit" picker.
 *
 * `audit: update` authorizes updating audits in general, not every audit. A
 * role limited to assigned audits (`access.audits.seeAll` false) must only get
 * the pending audits assigned to the caller, matching the audits index.
 *
 * The real audit service runs; only the database and the auth gate are mocked.
 *
 * @see {@link file://./../../../app/routes/api+/audits.get-pending.ts}
 */
import { accessFor } from "@helpers/role-access";

const { mockAuditFindMany, mockRequirePermission } = vi.hoisted(() => ({
  mockAuditFindMany: vi.fn(),
  mockRequirePermission: vi.fn(),
}));

// why: the audits are read with Prisma; no real database in tests. The
// `where` it receives is the scope under test.
vi.mock("~/database/db.server", () => ({
  db: {
    $connect: vi.fn(),
    auditSession: { findMany: mockAuditFindMany },
  },
}));

// why: the RBAC gate is not under test; each case sets the caller's role
// and the `access` it resolves to.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

import { loader } from "~/routes/api+/audits.get-pending";

function loaderArgs() {
  return {
    request: new Request("https://app.shelf.nu/api/audits/get-pending"),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0];
}

describe("pending audits loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditFindMany.mockResolvedValue([]);
  });

  it.each(["BASE", "SELF_SERVICE"] as const)(
    "lists only the caller's assigned pending audits for %s",
    async (role) => {
      mockRequirePermission.mockResolvedValue({
        organizationId: "org-1",
        access: accessFor([role]),
      });

      await loader(loaderArgs());

      expect(mockAuditFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: "org-1",
            status: "PENDING",
            assignments: { some: { userId: "user-1" } },
          },
        })
      );
    }
  );

  it("lists every pending audit in the workspace for an admin", async () => {
    mockRequirePermission.mockResolvedValue({
      organizationId: "org-1",
      access: accessFor(["ADMIN"]),
    });

    await loader(loaderArgs());

    expect(mockAuditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", status: "PENDING" },
      })
    );
  });
});
