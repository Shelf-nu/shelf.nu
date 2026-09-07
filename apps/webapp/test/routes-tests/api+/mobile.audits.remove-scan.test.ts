/**
 * Test suite for POST /api/mobile/audits/remove-scan.
 *
 * `removeAuditScan` (the service) has its own behaviour tests, and its JSDoc is
 * explicit that "callers own authentication and assignee gating" — so the auth
 * stack is exactly what this endpoint adds and exactly what needs covering
 * here: the Audits add-on gate, the `audit: update` permission, the assignee
 * gate, and the role resolution that decides whether the assignee gate binds.
 *
 * `parseMobileBody`, `resolveMostPrivilegedRole` and the error helpers are the
 * REAL implementations. They are the logic under test — mocking them would
 * leave the route's own wiring unexercised. Only the two boundaries that reach
 * Supabase and Postgres are stubbed.
 *
 * @see {@link file://./../../../app/routes/api+/mobile+/audits.remove-scan.ts}
 */
import { action } from "~/routes/api+/mobile+/audits.remove-scan";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() so the handler can be invoked directly and its
// response read as a plain Response (React Router v7 single fetch).
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
          },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: external auth — these reach Supabase, which tests must not.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  getMobileUserContext: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: the service has its own behaviour suite (remove-scan.server.test.ts);
// here it is a boundary whose ARGUMENTS are the assertion.
vi.mock("~/modules/audit/service.server", () => ({
  removeAuditScan: vi.fn(),
  requireAuditAssignee: vi.fn(),
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import {
  removeAuditScan,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { ShelfError } from "~/utils/error";

const mockUser = { id: "user-1", email: "test@example.com" };

/** A well-formed remove-scan request; `body` may be a string to send raw. */
function createRemoveScanRequest(
  body: Record<string, unknown> | string,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/audits/remove-scan?orgId=${orgId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }
  );
}

const VALID_BODY = { auditSessionId: "session-1", assetId: "asset-1" };

describe("POST /api/mobile/audits/remove-scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    } as never);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1" as never);
    vi.mocked(getMobileUserContext).mockResolvedValue({
      roles: ["ADMIN"],
      canUseAudits: true,
    } as never);
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined as never);
    vi.mocked(requireAuditAssignee).mockResolvedValue(undefined as never);
    vi.mocked(removeAuditScan).mockResolvedValue({
      removed: true,
      foundAssetCount: 2,
      missingAssetCount: 2,
      unexpectedAssetCount: 1,
    });
  });

  it("removes the scan and returns the recomputed counts", async () => {
    const result = (await action(
      createActionArgs({ request: createRemoveScanRequest(VALID_BODY) })
    )) as unknown as Response;

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toEqual({
      success: true,
      removed: true,
      foundAssetCount: 2,
      missingAssetCount: 2,
      unexpectedAssetCount: 1,
    });

    expect(removeAuditScan).toHaveBeenCalledWith({
      auditSessionId: "session-1",
      assetId: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("passes an ADMIN through the assignee gate unrestricted", async () => {
    await action(
      createActionArgs({ request: createRemoveScanRequest(VALID_BODY) })
    );

    expect(requireAuditAssignee).toHaveBeenCalledWith({
      auditSessionId: "session-1",
      organizationId: "org-1",
      userId: "user-1",
      isSelfServiceOrBase: false,
    });
  });

  it("resolves the most privileged role, not the first one on the membership", async () => {
    // A membership carries roles as an array in no guaranteed order. Reading
    // roles[0] would treat this genuine admin as restricted and gate them to
    // audits they are assigned to. Pinned because the sibling record-scan
    // endpoint still reads the bare `role`, so this is easy to "simplify" back.
    vi.mocked(getMobileUserContext).mockResolvedValue({
      roles: ["SELF_SERVICE", "ADMIN"],
      canUseAudits: true,
    } as never);

    await action(
      createActionArgs({ request: createRemoveScanRequest(VALID_BODY) })
    );

    expect(requireAuditAssignee).toHaveBeenCalledWith(
      expect.objectContaining({ isSelfServiceOrBase: false })
    );
  });

  it("binds the assignee gate for a SELF_SERVICE user", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue({
      roles: ["SELF_SERVICE"],
      canUseAudits: true,
    } as never);

    await action(
      createActionArgs({ request: createRemoveScanRequest(VALID_BODY) })
    );

    expect(requireAuditAssignee).toHaveBeenCalledWith(
      expect.objectContaining({ isSelfServiceOrBase: true })
    );
  });

  it("403s when the workspace has no Audits add-on, without touching the audit", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue({
      roles: ["ADMIN"],
      canUseAudits: false,
    } as never);

    const result = (await action(
      createActionArgs({ request: createRemoveScanRequest(VALID_BODY) })
    )) as unknown as Response;

    expect(result.status).toBe(403);
    expect(removeAuditScan).not.toHaveBeenCalled();
    expect(requireAuditAssignee).not.toHaveBeenCalled();
  });

  it("surfaces the assignee rejection and never reaches the service", async () => {
    // Removing a scan rewrites audit data, so a non-assignee must not be able
    // to hollow out an audit they are not part of.
    vi.mocked(getMobileUserContext).mockResolvedValue({
      roles: ["BASE"],
      canUseAudits: true,
    } as never);
    // The real guard throws a ShelfError carrying its own status; a bare
    // Error with a `status` property would be wrapped into a 500 by
    // makeShelfError, which is not what this path does in production.
    vi.mocked(requireAuditAssignee).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "Only users assigned to this audit can perform this action. Please contact the audit creator to be assigned.",
        label: "Audit",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const result = (await action(
      createActionArgs({ request: createRemoveScanRequest(VALID_BODY) })
    )) as unknown as Response;

    expect(result.status).toBe(403);
    expect(removeAuditScan).not.toHaveBeenCalled();
  });

  it("400s a malformed body instead of 500-ing on it", async () => {
    // A bare ZodError reaches makeShelfError's generic branch and becomes a
    // captured 500; parseMobileBody is what keeps client input on the 400 path.
    const result = (await action(
      createActionArgs({
        request: createRemoveScanRequest({ auditSessionId: "session-1" }),
      })
    )) as unknown as Response;

    expect(result.status).toBe(400);
    expect(removeAuditScan).not.toHaveBeenCalled();
  });

  it("400s a body that is not JSON at all", async () => {
    const result = (await action(
      createActionArgs({ request: createRemoveScanRequest("not json{") })
    )) as unknown as Response;

    expect(result.status).toBe(400);
    expect(removeAuditScan).not.toHaveBeenCalled();
  });

  it("reports removed: false when there was no scan to remove", async () => {
    // Idempotent by design: a double-tap on the phone is not an error.
    vi.mocked(removeAuditScan).mockResolvedValue({
      removed: false,
      foundAssetCount: 3,
      missingAssetCount: 1,
      unexpectedAssetCount: 1,
    });

    const result = (await action(
      createActionArgs({ request: createRemoveScanRequest(VALID_BODY) })
    )) as unknown as Response;

    expect(result.status).toBe(200);
    expect((await result.json()).removed).toBe(false);
  });
});
