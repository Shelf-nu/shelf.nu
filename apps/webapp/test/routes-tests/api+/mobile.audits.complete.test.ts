import { action } from "~/routes/api+/mobile.audits.complete";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: external service — we mock audit completion to avoid database calls
vi.mock("~/modules/audit/service.server", () => ({
  completeAuditSession: vi.fn(),
  requireAuditAssignee: vi.fn(),
}));

// why: we need to control error formatting in the catch block
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn(),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  completeAuditSession,
  requireAuditAssignee,
} from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createCompleteRequest(body: Record<string, unknown>, orgId = "org-1") {
  return new Request(
    `http://localhost/api/mobile/audits/complete?orgId=${orgId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/mobile/audits/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
    (requireAuditAssignee as any).mockResolvedValue(undefined);
    (completeAuditSession as any).mockResolvedValue(undefined);
  });

  it("should complete an audit session successfully", async () => {
    const request = createCompleteRequest({
      sessionId: "session-1",
      completionNote: "All assets accounted for",
      timeZone: "America/New_York",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);

    expect(requireAuditAssignee).toHaveBeenCalledWith({
      auditSessionId: "session-1",
      organizationId: "org-1",
      userId: "user-1",
      isSelfServiceOrBase: false,
    });

    expect(completeAuditSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      organizationId: "org-1",
      userId: "user-1",
      completionNote: "All assets accounted for",
      hints: { timeZone: "America/New_York", locale: "en-US" },
    });
  });

  it("should return 403 when user is not an audit assignee", async () => {
    const assigneeError = new Error("Not an assignee");
    (assigneeError as any).status = 403;
    (requireAuditAssignee as any).mockRejectedValue(assigneeError);
    (makeShelfError as any).mockReturnValue({
      message: "Not an assignee",
      status: 403,
    });

    const request = createCompleteRequest({ sessionId: "session-1" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Not an assignee");

    expect(completeAuditSession).not.toHaveBeenCalled();
  });

  it("should return 403 when user lacks audit update permission", async () => {
    const permError = new Error("Permission denied");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);
    (makeShelfError as any).mockReturnValue({
      message: "Permission denied",
      status: 403,
    });

    const request = createCompleteRequest({ sessionId: "session-1" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");

    expect(completeAuditSession).not.toHaveBeenCalled();
  });
});
