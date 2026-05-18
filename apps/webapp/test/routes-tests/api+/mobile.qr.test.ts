import { loader } from "~/routes/api+/mobile+/qr.$qrId";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vitest.hoisted(() => {
  return () =>
    vitest.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  MOBILE_ASSET_SELECT: {
    id: true,
    title: true,
    status: true,
    mainImage: true,
    category: { select: { name: true } },
    location: { select: { name: true } },
  },
}));

// why: external database — we don't want to hit the real database in tests
vitest.mock("~/database/db.server", () => ({
  db: {
    qr: {
      findUnique: vitest.fn(),
    },
    userOrganization: {
      findUnique: vitest.fn(),
    },
    asset: {
      findUnique: vitest.fn(),
    },
  },
}));

// why: external service — we assert provenance is recorded without hitting the DB
vitest.mock("~/modules/scan/service.server", () => ({
  createScan: vitest.fn(),
}));

// why: we assert non-fatal logging without emitting real logs
vitest.mock("~/utils/logger", () => ({
  Logger: { error: vitest.fn() },
}));

// why: we control error formatting in the loader's catch block (return
// path) without pulling in the real logger/Sentry wiring
vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn(),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { createScan } from "~/modules/scan/service.server";
import { makeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

const mockAsset = {
  id: "asset-1",
  title: "Test Laptop",
  status: "AVAILABLE",
  mainImage: null,
  category: { name: "Electronics" },
  location: { name: "Office A" },
};

const mockQr = {
  id: "qr-1",
  assetId: "asset-1",
  kitId: null,
  organizationId: "org-1",
};

function createQrRequest(userAgent?: string) {
  const headers: Record<string, string> = {
    Authorization: "Bearer test-token",
  };
  if (userAgent !== undefined) {
    headers["user-agent"] = userAgent;
  }
  return new Request("http://localhost:3000/api/mobile/qr/qr-1", { headers });
}

function run(request: Request) {
  return loader(createLoaderArgs({ request, params: { qrId: "qr-1" } }));
}

describe("GET /api/mobile/qr/:qrId", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (db.qr.findUnique as any).mockResolvedValue(mockQr);
    (db.userOrganization.findUnique as any).mockResolvedValue({ id: "uo-1" });
    (db.asset.findUnique as any).mockResolvedValue(mockAsset);
    (createScan as any).mockResolvedValue({ id: "scan-1" });
  });

  it("resolves a QR to its linked asset and records scan provenance", async () => {
    const result = await run(createQrRequest("ShelfCompanion/1.0 iOS"));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.qr.id).toBe("qr-1");
    expect(body.qr.asset.id).toBe("asset-1");

    // why: who + when provenance must be written on a successful resolve
    expect(createScan).toHaveBeenCalledWith({
      userAgent: "ShelfCompanion/1.0 iOS",
      userId: "user-1",
      qrId: "qr-1",
      deleted: false,
    });
  });

  it("falls back to a channel user-agent when the header is absent", async () => {
    await run(createQrRequest());

    expect(createScan).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: "mobile-companion" })
    );
  });

  it("does NOT record provenance when the QR is not found (404)", async () => {
    (db.qr.findUnique as any).mockResolvedValue(null);

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(createScan).not.toHaveBeenCalled();
  });

  it("does NOT record provenance when the QR has no organization (404)", async () => {
    (db.qr.findUnique as any).mockResolvedValue({
      ...mockQr,
      organizationId: null,
    });

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(createScan).not.toHaveBeenCalled();
  });

  it("does NOT record provenance for a cross-organization QR (403)", async () => {
    (db.userOrganization.findUnique as any).mockResolvedValue(null);

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(403);
    expect(createScan).not.toHaveBeenCalled();
  });

  it("is non-fatal: a provenance failure still resolves the asset", async () => {
    (createScan as any).mockRejectedValue(new Error("scan-note write failed"));

    const result = await run(createQrRequest());

    // why: a provenance hiccup must never break the scanner
    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();
    expect(body.qr.asset.id).toBe("asset-1");
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it("handles auth errors from requireMobileAuth", async () => {
    const authError = new Error("Invalid or expired token");
    (authError as any).status = 401;
    (requireMobileAuth as any).mockRejectedValue(authError);
    (makeShelfError as any).mockReturnValue({
      message: "Invalid or expired token",
      status: 401,
    });

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(401);
    expect(createScan).not.toHaveBeenCalled();
  });
});
