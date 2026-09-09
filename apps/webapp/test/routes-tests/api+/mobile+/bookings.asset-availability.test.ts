/**
 * Behaviour tests for the mobile booking asset-availability endpoint.
 *
 * The loader answers "how many units of each quantity-tracked asset may this
 * booking still book?" for the companion's scanner and booking screens. These
 * tests pin the response shape, that the shared availability primitive is
 * asked about the booking's own window with the booking itself excluded, that
 * ids outside the workspace are silently dropped, and the 400/404 refusals.
 *
 * @see {@link file://./bookings.asset-availability.ts} route under test
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getAssetAvailabilityBatch } from "~/modules/asset/availability.server";

import { loader } from "~/routes/api+/mobile+/bookings.asset-availability";

import { assertIsDataWithResponseInit } from "@helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary — the route resolves the booking's
// window and the set of owned quantity-tracked ids from it. Mock only those.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    asset: { findMany: vi.fn() },
  },
}));

// why: auth + entitlement are out of scope for these shape tests — stub them
// to resolve to a fixed user + org. The real module is otherwise preserved.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
  };
});

// why: the availability math lives in the shared primitive and has its own
// coverage; here we assert what the route asks it and how it maps the answer.
vi.mock("~/modules/asset/availability.server", () => ({
  getAssetAvailabilityBatch: vi.fn(),
}));

const bookingFindFirstMock = vi.mocked(db.booking.findFirst);
const assetFindManyMock = vi.mocked(db.asset.findMany);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const availabilityBatchMock = vi.mocked(getAssetAvailabilityBatch);

const CALLER_ID = "user-self";
const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const BOOKING_FROM = new Date("2026-09-10T09:00:00.000Z");
const BOOKING_TO = new Date("2026-09-12T17:00:00.000Z");

/** Build a GET request for this endpoint from raw query params. */
function makeArgs(query: Record<string, string>) {
  const url = new URL(
    "http://localhost:3000/api/mobile/bookings/asset-availability"
  );
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return createLoaderArgs({ request: new Request(url) });
}

/** One availability answer, as the batch primitive would return it. */
function availability(counts: {
  total: number;
  bookable: number;
  reserved: number;
  inCustody: number;
}) {
  return counts;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: CALLER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(ORG_ID);

  bookingFindFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    from: BOOKING_FROM,
    to: BOOKING_TO,
  } as never);
  assetFindManyMock.mockResolvedValue([]);
  availabilityBatchMock.mockResolvedValue(new Map());
});

describe("GET /api/mobile/bookings/asset-availability", () => {
  it("returns one row per owned quantity-tracked id, measured over the booking's window with itself excluded", async () => {
    assetFindManyMock.mockResolvedValue([
      { id: "asset-1" },
      { id: "asset-2" },
    ] as never);
    availabilityBatchMock.mockResolvedValue(
      new Map([
        [
          "asset-1",
          availability({ total: 10, bookable: 7, reserved: 3, inCustody: 0 }),
        ],
        [
          "asset-2",
          availability({ total: 4, bookable: 0, reserved: 2, inCustody: 2 }),
        ],
      ]) as never
    );

    const response = await loader(
      makeArgs({ bookingId: BOOKING_ID, assetIds: "asset-1,asset-2" })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toEqual({
      availability: [
        {
          assetId: "asset-1",
          total: 10,
          bookable: 7,
          reserved: 3,
          inCustody: 0,
        },
        {
          assetId: "asset-2",
          total: 4,
          bookable: 0,
          reserved: 2,
          inCustody: 2,
        },
      ],
    });

    expect(availabilityBatchMock).toHaveBeenCalledTimes(1);
    expect(availabilityBatchMock).toHaveBeenCalledWith(["asset-1", "asset-2"], {
      organizationId: ORG_ID,
      window: { from: BOOKING_FROM, to: BOOKING_TO },
      excludeBookingId: BOOKING_ID,
    });
  });

  it("drops ids outside the workspace instead of reporting them", async () => {
    // Only asset-1 is a quantity-tracked asset of this org.
    assetFindManyMock.mockResolvedValue([{ id: "asset-1" }] as never);
    availabilityBatchMock.mockResolvedValue(
      new Map([
        [
          "asset-1",
          availability({ total: 10, bookable: 7, reserved: 3, inCustody: 0 }),
        ],
      ]) as never
    );

    const response = await loader(
      makeArgs({ bookingId: BOOKING_ID, assetIds: "asset-1,asset-foreign" })
    );

    assertIsDataWithResponseInit(response);
    const body = response.data as {
      availability: Array<{ assetId: string }>;
    };
    expect(body.availability.map((row) => row.assetId)).toEqual(["asset-1"]);
    expect(JSON.stringify(body)).not.toContain("asset-foreign");

    // The ownership filter is org- and type-scoped, and the primitive is only
    // ever asked about ids that passed it.
    expect(assetFindManyMock.mock.calls[0]![0]!.where).toMatchObject({
      id: { in: ["asset-1", "asset-foreign"] },
      organizationId: ORG_ID,
      type: "QUANTITY_TRACKED",
    });
    expect(availabilityBatchMock).toHaveBeenCalledWith(
      ["asset-1"],
      expect.anything()
    );
  });

  it.each([
    ["bookingId", { assetIds: "asset-1" }],
    ["assetIds", { bookingId: BOOKING_ID }],
  ])("400s when %s is missing", async (_missing, query) => {
    const response = await loader(makeArgs(query));

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(bookingFindFirstMock).not.toHaveBeenCalled();
    expect(availabilityBatchMock).not.toHaveBeenCalled();
  });

  it("404s when the booking is not in the caller's workspace", async () => {
    bookingFindFirstMock.mockResolvedValue(null);

    const response = await loader(
      makeArgs({ bookingId: "booking-elsewhere", assetIds: "asset-1" })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    expect(assetFindManyMock).not.toHaveBeenCalled();
    expect(availabilityBatchMock).not.toHaveBeenCalled();
  });
});
