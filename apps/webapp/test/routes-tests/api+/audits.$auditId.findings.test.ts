// @vitest-environment node
/**
 * Audit findings API: who may page through an audit's findings, and which
 * page they get.
 *
 * @see {@link file://./../../../app/routes/api+/audits.$auditId.findings.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { accessFor } from "@helpers/role-access";
import { ShelfError } from "~/utils/error";

// why: React Router v7 single fetch. `data()` must return a real Response so
// status codes are assertable.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

const { mockRequirePermission, mockRequireAuditAssignee, mockGetPage } =
  vi.hoisted(() => ({
    mockRequirePermission: vi.fn(),
    mockRequireAuditAssignee: vi.fn(),
    mockGetPage: vi.fn(),
  }));

// why: the RBAC gate is not under test; it passes so the assignment check is
// what decides.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

// why: the guard does a DB lookup; each test chooses assigned or not.
vi.mock("~/modules/audit/service.server", () => ({
  requireAuditAssignee: mockRequireAuditAssignee,
}));

// why: the database read; also the sink asserted unreached on refusal.
vi.mock("~/modules/audit/findings.server", () => ({
  getAuditFindingsPage: mockGetPage,
}));

import { loader } from "~/routes/api+/audits.$auditId.findings";

const AUDIT_ID = "audit-1";
const ORG_ID = "org-1";

function args(query: string) {
  return {
    request: new Request(
      `https://app.shelf.nu/api/audits/${AUDIT_ID}/findings${query}`
    ),
    params: { auditId: AUDIT_ID },
    context: { getSession: () => ({ userId: "user-1", email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0];
}

describe("GET /api/audits/:auditId/findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermission.mockResolvedValue({
      organizationId: ORG_ID,
      access: accessFor([OrganizationRoles.BASE]),
    });
    mockRequireAuditAssignee.mockResolvedValue(undefined);
    mockGetPage.mockResolvedValue({
      findings: [],
      page: 2,
      totalFindings: 12,
      hasMore: false,
    });
  });

  it("returns the requested page, scoped to the caller's workspace", async () => {
    const response = (await loader(args("?page=2"))) as unknown as Response;

    expect(response.status).toBe(200);
    expect(mockGetPage).toHaveBeenCalledWith({
      auditSessionId: AUDIT_ID,
      organizationId: ORG_ID,
      page: 2,
    });
    await expect(response.json()).resolves.toMatchObject({
      page: 2,
      totalFindings: 12,
    });
  });

  it("checks the assignment for a member limited to assigned audits", async () => {
    await loader(args("?page=2"));

    expect(mockRequireAuditAssignee).toHaveBeenCalledWith(
      expect.objectContaining({
        auditSessionId: AUDIT_ID,
        organizationId: ORG_ID,
        assignedOnly: true,
      })
    );
  });

  it("refuses an unassigned member before reading anything", async () => {
    const refusal = new ShelfError({
      cause: null,
      message: "You don't have permission to view this audit",
      status: 403,
      label: "Audit",
    });
    mockRequireAuditAssignee.mockRejectedValue(refusal);

    const response = (await loader(args("?page=2"))) as unknown as Response;

    expect(response.status).toBe(403);
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it.each(["", "?page=0", "?page=-1", "?page=abc"])(
    "rejects a missing or invalid page (%s)",
    async (query) => {
      const response = (await loader(args(query))) as unknown as Response;

      expect(response.status).toBe(400);
      expect(mockGetPage).not.toHaveBeenCalled();
    }
  );
});
