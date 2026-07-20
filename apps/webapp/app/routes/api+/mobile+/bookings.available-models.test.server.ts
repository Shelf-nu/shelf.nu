/**
 * Tests for the mobile Book-by-Model picker endpoint.
 *
 * Two behaviors matter: (1) the booking read is custodian-scoped for
 * SELF_SERVICE / BASE — they may only pick models against a booking they own
 * (same rule as the booking detail read), and (2) the response is trimmed to a
 * mobile shape (drops the web-only DynamicSelect seed list).
 *
 * @see {@link file://./bookings.available-models.ts} route under test
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { getBookingModelTabData } from "~/modules/booking-model-request/service.server";

import { loader } from "./bookings.available-models";

import { assertIsDataWithResponseInit } from "../../../../test/helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary — we assert the `where` the route builds
// so the custodian scoping is provably applied. Mock booking.findFirst only.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: auth/entitlement helpers are out of scope; stub them but keep
// getMobileUserContext a spy so tests can vary the caller's role.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

// why: the availability math is covered by the service's own unit tests; here
// we only assert the route forwards the booking and trims the payload.
vi.mock("~/modules/booking-model-request/service.server", () => ({
  getBookingModelTabData: vi.fn(),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);
const getTabDataMock = vi.mocked(getBookingModelTabData);

const CALLER_ID = "user-self";
const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";

function withRole(role: OrganizationRoles) {
  getMobileUserContextMock.mockResolvedValue({
    role,
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: true,
  });
}

function makeArgs() {
  return createLoaderArgs({
    request: new Request(
      `http://localhost:3000/api/mobile/bookings/available-models?bookingId=${BOOKING_ID}`
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: CALLER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(ORG_ID);
  findFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    from: null,
    to: null,
    modelRequests: [],
  } as never);
  getTabDataMock.mockResolvedValue({
    showModelsTab: true,
    assetModels: [],
    initialAssetModels: [],
    totalAssetModels: 0,
    modelRequests: [],
  });
});

describe("GET /api/mobile/bookings/available-models", () => {
  it("scopes the booking read to the caller's custody for SELF_SERVICE", async () => {
    withRole(OrganizationRoles.SELF_SERVICE);

    await loader(makeArgs());

    const where = findFirstMock.mock.calls[0]![0]!.where;
    expect(where).toMatchObject({
      id: BOOKING_ID,
      organizationId: ORG_ID,
      custodianUserId: CALLER_ID,
    });
  });

  it("does NOT custody-scope the booking read for ADMIN", async () => {
    withRole(OrganizationRoles.ADMIN);

    await loader(makeArgs());

    const where = findFirstMock.mock.calls[0]![0]!.where;
    expect(where).not.toHaveProperty("custodianUserId");
  });

  it("forwards the `s` query param to getBookingModelTabData as `search` (server-side model search)", async () => {
    // Regression for the >50-models gap: the picker list is capped, so search
    // must reach the server — a client-only filter can't find later models.
    withRole(OrganizationRoles.ADMIN);

    await loader(
      createLoaderArgs({
        request: new Request(
          `http://localhost:3000/api/mobile/bookings/available-models?bookingId=${BOOKING_ID}&s=dell`
        ),
      })
    );

    expect(getTabDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, search: "dell" })
    );
  });

  it("404s when the booking is not visible to the caller", async () => {
    withRole(OrganizationRoles.SELF_SERVICE);
    findFirstMock.mockResolvedValue(null);

    const response = await loader(makeArgs());

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    expect(getTabDataMock).not.toHaveBeenCalled();
  });

  it("trims the payload to the mobile shape (drops initialAssetModels)", async () => {
    withRole(OrganizationRoles.ADMIN);
    getTabDataMock.mockResolvedValue({
      showModelsTab: true,
      assetModels: [
        {
          id: "m-1",
          name: "Dell XPS",
          total: 10,
          available: 6,
          inCustody: 1,
          reservedConcrete: 2,
          reservedViaRequest: 1,
        },
      ],
      initialAssetModels: [
        { id: "m-1", name: "Dell XPS", metadata: {} as never },
      ],
      totalAssetModels: 1,
      modelRequests: [
        {
          assetModelId: "m-1",
          assetModelName: "Dell XPS",
          quantity: 3,
          fulfilledQuantity: 1,
          fulfilledAt: null,
        },
      ],
    });

    const response = await loader(makeArgs());
    assertIsDataWithResponseInit(response);
    const body = response.data as {
      showModelsTab: boolean;
      assetModels: Array<{ id: string; available: number }>;
      totalAssetModels: number;
      modelRequests: Array<{ assetModelId: string }>;
      initialAssetModels?: unknown;
    };

    expect(body.showModelsTab).toBe(true);
    expect(body.assetModels[0]).toMatchObject({ id: "m-1", available: 6 });
    expect(body.totalAssetModels).toBe(1);
    expect(body.modelRequests[0]).toMatchObject({ assetModelId: "m-1" });
    // Web-only seed list must NOT leak into the mobile payload.
    expect(body.initialAssetModels).toBeUndefined();
  });
});
