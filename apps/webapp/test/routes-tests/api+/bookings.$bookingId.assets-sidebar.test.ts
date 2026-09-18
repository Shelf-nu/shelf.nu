// @vitest-environment node
// why: the route imports `bookingDraftVisibilityClause` from
// `booking/service.server`, whose import graph transitively reaches
// canvas-dependent UI deps (lottie) that crash happy-dom at import time. A
// route-handler test needs no DOM — the repo's established fix for this.
/**
 * Guard tests for `api+/bookings.$bookingId.assets-sidebar.ts`.
 *
 * This route exists because the bookings-list loaders stopped shipping asset
 * payloads — which means a read that used to be gated by the list query is now
 * addressable by booking id. `booking:read` passes for SELF_SERVICE and BASE
 * too, so the org scope alone would let either role pull any booking's asset
 * list. These tests pin the three things that keep the route as narrow as the
 * list it replaced: the org scope, the draft-visibility clause, and the
 * restricted-role custody check.
 *
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.assets-sidebar.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/api+/bookings.$bookingId.assets-sidebar";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so the route handler can be invoked
// directly inside vitest without a Remix runtime.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
          },
        })
    )
);

const dbMocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
  consumptionLogGroupBy: vi.fn(),
  partialCheckoutFindMany: vi.fn(),
}));

// why: the route reads the booking and two aggregates directly via Prisma;
// injecting the responses drives the guard branches without a database.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: dbMocks.bookingFindFirst },
    consumptionLog: { groupBy: dbMocks.consumptionLogGroupBy },
    partialBookingCheckout: { findMany: dbMocks.partialCheckoutFindMany },
  },
}));

// why: each test supplies the (organizationId, canSeeAllBookings) it needs
// rather than running the real permission machinery.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the loader returns `data(...)`; swapping it for a plain Response factory
// lets the handler be invoked directly, with no router runtime to stand up.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

const requirePermissionMock = vi.mocked(requirePermission);

const CURRENT_USER = "user-current";

/**
 * Builds the loader arguments for a request against `booking-1`.
 *
 * @returns Loader args with a session for {@link CURRENT_USER}
 */
function buildArgs(): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: CURRENT_USER }) },
    request: new Request(
      "https://example.com/api/bookings/booking-1/assets-sidebar"
    ),
    params: { bookingId: "booking-1" },
  } as unknown as LoaderFunctionArgs;
}

/** A booking row as the route selects it, with no custody links by default. */
function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    custodianUserId: null,
    custodianTeamMember: null,
    bookingAssets: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.consumptionLogGroupBy.mockResolvedValue([]);
  dbMocks.partialCheckoutFindMany.mockResolvedValue([]);
  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
    canSeeAllBookings: true,
  } as never);
});

describe("api/bookings/:bookingId/assets-sidebar — read gate", () => {
  it("scopes the lookup to the caller's organization and hides other people's drafts", async () => {
    dbMocks.bookingFindFirst.mockResolvedValue(bookingRow());

    await loader(buildArgs());

    const where = dbMocks.bookingFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe("booking-1");
    expect(where.organizationId).toBe("org-1");
    // `bookingDraftVisibilityClause` — a DRAFT is visible to its creator only.
    expect(where.AND).toEqual([
      {
        OR: [
          { status: { not: "DRAFT" } },
          { AND: [{ status: "DRAFT" }, { creatorId: CURRENT_USER }] },
        ],
      },
    ]);
  });

  it("404s when the booking is outside the caller's organization", async () => {
    // The org scope is in the `where`, so a cross-org id simply matches nothing.
    dbMocks.bookingFindFirst.mockResolvedValue(null);

    const response = (await loader(buildArgs())) as unknown as Response;

    expect(response.status).toBe(404);
  });

  it("403s a restricted user asking for a booking they do not hold", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      canSeeAllBookings: false,
    } as never);
    dbMocks.bookingFindFirst.mockResolvedValue(
      bookingRow({
        custodianUserId: "someone-else",
        custodianTeamMember: { userId: "someone-else" },
      })
    );

    const response = (await loader(buildArgs())) as unknown as Response;

    expect(response.status).toBe(403);
  });

  it("serves a restricted user their own booking, matched on the team-member link", async () => {
    // Legacy rows record custody on the team member alone, with
    // `custodianUserId` never backfilled — `canSeeBooking` matches either link.
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      canSeeAllBookings: false,
    } as never);
    dbMocks.bookingFindFirst.mockResolvedValue(
      bookingRow({
        custodianUserId: null,
        custodianTeamMember: { userId: CURRENT_USER },
      })
    );

    const response = (await loader(buildArgs())) as unknown as Response;

    expect(response.status).toBe(200);
  });
});

describe("api/bookings/:bookingId/assets-sidebar — payload", () => {
  it("returns the asset rows with the qty-progress maps the drawer renders", async () => {
    dbMocks.bookingFindFirst.mockResolvedValue(
      bookingRow({
        bookingAssets: [{ id: "ba-1", quantity: 5, assetKitId: null }],
      })
    );
    dbMocks.consumptionLogGroupBy.mockResolvedValue([
      { assetId: "asset-1", category: "RETURN", _sum: { quantity: 2 } },
      { assetId: "asset-1", category: "DAMAGE", _sum: { quantity: 1 } },
    ]);
    dbMocks.partialCheckoutFindMany.mockResolvedValue([
      { assetIds: ["asset-1"], quantities: [4] },
    ]);

    const response = (await loader(buildArgs())) as unknown as Response;
    const body = await response.json();

    // The whole envelope, not just the rows: the success path runs through
    // `payload()`, which stamps `error: null` onto every response. The drawer
    // has to discriminate on `bookingAssets` because of it, so the shape is
    // part of this route's contract rather than an implementation detail.
    expect(body.error).toBeNull();
    expect(body.bookingAssets).toEqual([
      { id: "ba-1", quantity: 5, assetKitId: null },
    ]);
    // Returned and damaged both leave the booking, so they sum into the total…
    expect(body.dispositionedByAsset).toEqual({ "asset-1": 3 });
    // …but the tooltip has to tell them apart.
    expect(body.dispositionBreakdownByAsset).toEqual({
      "asset-1": { returned: 2, consumed: 0, lost: 0, damaged: 1 },
    });
    expect(body.checkedOutByAsset).toEqual({ "asset-1": 4 });
  });

  it("counts one unit per entry for legacy checkout rows with no quantities", async () => {
    // Pre-progressive-checkout rows have `quantities` shorter than `assetIds`
    // (often empty). Matches `countCheckedOutUnitsForAsset`.
    dbMocks.bookingFindFirst.mockResolvedValue(bookingRow());
    dbMocks.partialCheckoutFindMany.mockResolvedValue([
      { assetIds: ["asset-1", "asset-2", "asset-1"], quantities: [] },
    ]);

    const response = (await loader(buildArgs())) as unknown as Response;
    const body = await response.json();

    expect(body.checkedOutByAsset).toEqual({ "asset-1": 2, "asset-2": 1 });
  });

  it("scopes both aggregates to this booking", async () => {
    dbMocks.bookingFindFirst.mockResolvedValue(bookingRow());

    await loader(buildArgs());

    expect(dbMocks.consumptionLogGroupBy.mock.calls[0][0].where).toMatchObject({
      bookingId: "booking-1",
    });
    expect(dbMocks.partialCheckoutFindMany.mock.calls[0][0].where).toEqual({
      bookingId: "booking-1",
    });
  });
});
