import { loader } from "~/routes/api+/mobile+/assets.$assetId.bookings";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() so the loader returns real Response objects
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
  return { ...actual, data: createDataMock() };
});

// why: external auth — no Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: sentinels, not reimplementations. WHICH bookings a self-service user
// may see is decided by these shared helpers, and the bookings list and the
// calendar use the same pair. This route's job is to delegate to them, so
// that is what is asserted; copying their logic here would only test the copy.
vi.mock("~/modules/booking/service.server", () => ({
  bookingDraftVisibilityClause: vi.fn(() => ({ __draftClause: true })),
  resolveCustodianScope: vi.fn(async () => ({
    userId: "user-1",
    teamMemberIds: ["tm-1"],
  })),
  custodianScopeClause: vi.fn(() => ({ __custodianClause: true })),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findFirst: vi.fn() },
    booking: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message ?? "error",
    status: cause?.status ?? 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import { db } from "~/database/db.server";
import {
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

const mockDb = db as unknown as {
  asset: { findFirst: ReturnType<typeof vi.fn> };
  booking: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

/** The `where` the loader handed Prisma on its last booking query. */
function lastWhere() {
  return mockDb.booking.findMany.mock.calls.at(-1)?.[0]?.where;
}

function request(qs = "orgId=org-1") {
  return new Request(
    `http://localhost/api/mobile/assets/asset-1/bookings?${qs}`,
    {
      headers: { Authorization: "Bearer token" },
    }
  );
}

const ARGS = { params: { assetId: "asset-1" } };

describe("GET /api/mobile/assets/:assetId/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireMobileAuth as any).mockResolvedValue({ user: { id: "user-1" } });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
    mockDb.asset.findFirst.mockResolvedValue({ id: "asset-1" });
    mockDb.booking.findMany.mockResolvedValue([]);
    mockDb.booking.count.mockResolvedValue(0);
  });

  describe("custodian scope", () => {
    it("matches a SELF_SERVICE user through the shared scope, not the user link alone", async () => {
      // why: this is the regression. Matching only `custodianUserId` hides a
      // booking whose custodian was assigned by picking a TEAM MEMBER rather
      // than a user — it shows on the website and vanishes on the phone, for
      // the very user it belongs to. On this screen it misfires worse than on
      // a list, because the section then states "This asset has never been
      // booked", which is a claim rather than an empty list.
      (getMobileUserContext as any).mockResolvedValue({ role: "SELF_SERVICE" });

      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      expect(resolveCustodianScope).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
      });
      expect(custodianScopeClause).toHaveBeenCalledWith({
        userId: "user-1",
        teamMemberIds: ["tm-1"],
      });

      const where = lastWhere();
      expect(where.AND).toContainEqual({ __custodianClause: true });
      // The old shape must be gone, not merely supplemented.
      expect(where.custodianUserId).toBeUndefined();
    });

    it("applies the same scope to BASE", async () => {
      (getMobileUserContext as any).mockResolvedValue({ role: "BASE" });

      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      expect(resolveCustodianScope).toHaveBeenCalled();
      expect(lastWhere().AND).toContainEqual({ __custodianClause: true });
    });

    it("does not scope an ADMIN to their own bookings", async () => {
      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      expect(resolveCustodianScope).not.toHaveBeenCalled();
      expect(lastWhere().AND).not.toContainEqual({ __custodianClause: true });
    });
  });

  describe("draft privacy", () => {
    it("always applies the shared draft clause", async () => {
      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      expect(lastWhere().AND).toContainEqual({ __draftClause: true });
    });
  });

  describe("cross-org protection", () => {
    it("404s for an asset outside the caller's workspace, without querying bookings", async () => {
      // why: proves the id cannot be probed through this route — a guessed id
      // from another org must not reveal whether it exists by returning a
      // different shape or an empty list.
      mockDb.asset.findFirst.mockResolvedValue(null);

      const response = await loader(
        createLoaderArgs({ request: request(), ...ARGS })
      );

      // why: `data()` is mocked to return a real Response; the loader's typed
      // return is the DataWithResponseInit union, hence the cast — the same
      // shape the sibling mobile route tests use.
      expect((response as unknown as Response).status).toBe(404);
      expect(mockDb.booking.findMany).not.toHaveBeenCalled();
    });
  });

  describe("which bookings", () => {
    it("matches bookings containing this asset, covering kit-driven slices", async () => {
      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      expect(lastWhere().bookingAssets).toEqual({
        some: { assetId: "asset-1" },
      });
    });

    it("excludes CANCELLED and ARCHIVED, and keeps COMPLETE", async () => {
      // why: past bookings are half of what this section is for.
      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      const statuses = lastWhere().status.in;
      expect(statuses).toContain("COMPLETE");
      expect(statuses).not.toContain("CANCELLED");
      expect(statuses).not.toContain("ARCHIVED");
    });
  });
});
