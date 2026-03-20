import { action } from "~/routes/api+/mobile+/audits.record-scan";
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
}));

// why: external service — we mock audit scan recording to avoid database calls
vi.mock("~/modules/audit/service.server", () => ({
  recordAuditScan: vi.fn(),
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
} from "~/modules/api/mobile-auth.server";
import { recordAuditScan } from "~/modules/audit/service.server";
import { makeShelfError } from "~/utils/error";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRecordScanRequest(
  body: Record<string, unknown>,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/audits/record-scan?orgId=${orgId}`,
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

describe("POST /api/mobile/audits/record-scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
  });

  it("should record a scan and return scan data with counts", async () => {
    (recordAuditScan as any).mockResolvedValue({
      scanId: "scan-1",
      auditAssetId: "audit-asset-1",
      foundAssetCount: 5,
      unexpectedAssetCount: 1,
    });

    const request = createRecordScanRequest({
      auditSessionId: "session-1",
      qrId: "qr-abc",
      assetId: "asset-1",
      isExpected: true,
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.scanId).toBe("scan-1");
    expect(body.auditAssetId).toBe("audit-asset-1");
    expect(body.foundAssetCount).toBe(5);
    expect(body.unexpectedAssetCount).toBe(1);

    expect(recordAuditScan).toHaveBeenCalledWith({
      auditSessionId: "session-1",
      qrId: "qr-abc",
      assetId: "asset-1",
      isExpected: true,
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("should return 403 when user lacks audit update permission", async () => {
    const permError = new Error("Permission denied");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);
    (makeShelfError as any).mockReturnValue({
      message: "Permission denied",
      status: 403,
    });

    const request = createRecordScanRequest({
      auditSessionId: "session-1",
      qrId: "qr-abc",
      assetId: "asset-1",
      isExpected: true,
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");

    expect(recordAuditScan).not.toHaveBeenCalled();
  });
});
