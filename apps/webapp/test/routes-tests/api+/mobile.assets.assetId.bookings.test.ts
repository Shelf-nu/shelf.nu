// @vitest-environment node

import { OrganizationRoles } from "@prisma/client";
import { loader } from "~/routes/api+/mobile+/assets.$assetId.bookings";
import { createLoaderArgs } from "@mocks/remix";

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

// why: no Postgres in unit tests, and the mock is also how the assertions read
// the exact `where` the booking query was built with.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findFirst: vi.fn() },
    booking: { findMany: vi.fn(), count: vi.fn() },
  },
}));

// why: keeps ShelfError status codes observable in the response without the
// real error pipeline logging through them.
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: unknown) => {
    const err = cause as { message?: string; status?: number } | null;
    return { message: err?.message ?? "error", status: err?.status ?? 500 };
  }),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: { message: string; status?: number }) {
      super(opts.message);
      this.status = opts.status ?? 500;
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

/**
 * Fixtures for the loader's inputs.
 *
 * Typed off the real return types rather than hand-rolled object literals, so
 * a mock that no longer matches what the function actually resolves fails to
 * compile instead of drifting quietly. Each takes overrides so a test states
 * only the field it cares about.
 */
type MobileAuth = Awaited<ReturnType<typeof requireMobileAuth>>;
type MobileContext = Awaited<ReturnType<typeof getMobileUserContext>>;

function mobileUser(overrides: Partial<MobileAuth["user"]> = {}): MobileAuth {
  return {
    user: {
      id: "user-1",
      email: "user-1@example.com",
      firstName: "Test",
      lastName: "User",
      profilePicture: null,
      onboarded: true,
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
      ...overrides,
    },
  } as MobileAuth;
}

function mobileContext(overrides: Partial<MobileContext> = {}): MobileContext {
  return {
    role: OrganizationRoles.ADMIN,
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: true,
    ...overrides,
  } as MobileContext;
}

function request(qs = "orgId=org-1", assetId = "asset-1") {
  return new Request(
    `http://localhost/api/mobile/assets/${assetId}/bookings?${qs}`,
    {
      headers: { Authorization: "Bearer token" },
    }
  );
}

const ARGS = { params: { assetId: "asset-1" } };

describe("GET /api/mobile/assets/:assetId/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMobileAuth).mockResolvedValue(mobileUser());
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined);
    vi.mocked(getMobileUserContext).mockResolvedValue(mobileContext());
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
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileContext({ role: OrganizationRoles.SELF_SERVICE })
      );

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
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileContext({ role: OrganizationRoles.BASE })
      );

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

  describe("pagination survives a hostile query string", () => {
    /** The `skip`/`take` the booking query actually ran with. */
    function lastPaging() {
      const call = mockDb.booking.findMany.mock.calls.at(-1)?.[0];
      return { skip: call?.skip, take: call?.take };
    }

    /** What the endpoint reported back to the caller. */
    async function body(res: unknown) {
      return (await (res as Response).json()) as {
        page: number;
        perPage: number;
      };
    }

    it("floors a fractional page rather than falling back to page 1", async () => {
      // 2.5 discriminates: flooring gives page 2, a fallback would give 1.
      // `page=1.5` could not tell the two apart - both land on skip 0.
      const res = await loader(
        createLoaderArgs({ request: request("orgId=org-1&page=2.5"), ...ARGS })
      );

      expect((await body(res)).page).toBe(2);
      expect(lastPaging().skip).toBe(20);
    });

    it("floors a fractional perPage to the page size it reports", async () => {
      const res = await loader(
        createLoaderArgs({
          request: request("orgId=org-1&perPage=2.5"),
          ...ARGS,
        })
      );

      expect((await body(res)).perPage).toBe(2);
      expect(lastPaging().take).toBe(2);
    });

    it("does not let a huge page overflow the computed skip", async () => {
      // 1.79e308 is finite AND an integer, so validating the input alone lets
      // it through; the overflow only appears once it is multiplied by perPage.
      const res = await loader(
        createLoaderArgs({
          request: request("orgId=org-1&page=1.7976931348623157e308"),
          ...ARGS,
        })
      );

      const { skip } = lastPaging();
      expect(Number.isSafeInteger(skip)).toBe(true);
      expect(skip).toBe(0);
      expect((await body(res)).page).toBe(1);
    });

    it("ignores a non-finite page", async () => {
      await loader(
        createLoaderArgs({
          request: request("orgId=org-1&page=Infinity"),
          ...ARGS,
        })
      );

      expect(lastPaging().skip).toBe(0);
    });

    it.each(["0", "-3", "abc", ""])(
      "falls back to the first page for page=%s",
      async (bad) => {
        await loader(
          createLoaderArgs({
            request: request(`orgId=org-1&page=${bad}`),
            ...ARGS,
          })
        );

        expect(lastPaging().skip).toBe(0);
      }
    );

    it("keeps perPage within its ceiling", async () => {
      await loader(
        createLoaderArgs({
          request: request("orgId=org-1&perPage=999"),
          ...ARGS,
        })
      );

      expect(lastPaging().take).toBe(50);
    });
  });
});
