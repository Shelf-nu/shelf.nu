// @vitest-environment node
/**
 * `/api/audit-images` — audit-scoped resolution of embedded evidence.
 *
 * The `ids` this endpoint receives come out of note content, which is
 * user-authored, so the caller effectively chooses them. Membership in the
 * organization is therefore not sufficient: audits are assignment-scoped for
 * BASE and SELF_SERVICE, and the query has to re-derive that here rather than
 * trust whichever note asked.
 *
 * @see {@link file://./../../../app/routes/api+/audit-images.tsx}
 */

import { OrganizationRoles } from "@prisma/client";

// why: React Router v7 single fetch — `data()` must return a real Response so
// the response body is assertable.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  };
});

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not what's under test — it must PASS, so the assertion
// proves the AUDIT scoping is what narrows the query, not `audit:read`.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/database/db.server", () => ({
  db: { auditImage: { findMany: mockFindMany } },
}));

import { loader } from "~/routes/api+/audit-images";

const ORG_ID = "org-1";
const USER_ID = "user-1";

function args(ids?: string) {
  const url = new URL("https://app.shelf.nu/api/audit-images");
  if (ids !== undefined) {
    url.searchParams.set("ids", ids);
  }

  return {
    request: new Request(url, { method: "GET" }),
    params: {},
    context: { getSession: () => ({ userId: USER_ID, email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0];
}

/** The `where` clause the route handed to Prisma on its single read. */
function whereClause() {
  return mockFindMany.mock.calls[0][0].where;
}

describe("GET /api/audit-images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockRequirePermission.mockResolvedValue({
      organizationId: ORG_ID,
      isSelfServiceOrBase: true,
      role: OrganizationRoles.BASE,
    });
  });

  it("limits a BASE caller to images from audits they are assigned to", async () => {
    await loader(args("img-1,img-2"));

    expect(whereClause()).toEqual({
      id: { in: ["img-1", "img-2"] },
      organizationId: ORG_ID,
      auditSession: { assignments: { some: { userId: USER_ID } } },
    });
  });

  it("limits a SELF_SERVICE caller the same way", async () => {
    mockRequirePermission.mockResolvedValue({
      organizationId: ORG_ID,
      isSelfServiceOrBase: true,
      role: OrganizationRoles.SELF_SERVICE,
    });

    await loader(args("img-1"));

    expect(whereClause().auditSession).toEqual({
      assignments: { some: { userId: USER_ID } },
    });
  });

  it("lets an ADMIN read any image in the workspace", async () => {
    mockRequirePermission.mockResolvedValue({
      organizationId: ORG_ID,
      isSelfServiceOrBase: false,
      role: OrganizationRoles.ADMIN,
    });

    await loader(args("img-1"));

    // No assignment narrowing — but still org-scoped, which is the tenant
    // boundary an ADMIN may not cross.
    expect(whereClause()).toEqual({
      id: { in: ["img-1"] },
      organizationId: ORG_ID,
    });
  });

  it("drops unreachable ids rather than failing the whole request", async () => {
    // A note may embed several images; one the caller can't see must not
    // blank out the ones they can.
    mockFindMany.mockResolvedValue([{ id: "img-1" }]);

    // The `data()` mock above returns a real Response; the static signature
    // still describes the single-fetch wrapper, hence the cast.
    const response = (await loader(args("img-1,img-2"))) as unknown as Response;
    const body = (await response.json()) as { images: { id: string }[] };

    expect(response.status).toBe(200);
    expect(body.images).toEqual([{ id: "img-1" }]);
  });

  it("reads nothing when no ids are asked for", async () => {
    await loader(args());

    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
