/**
 * Response-contract test for the mobile booking detail endpoint's Book-by-Model
 * payload. The companion app renders "Reserved model" rows + a scan-to-assign
 * progress from these fields, so the serialization (outstanding = quantity −
 * fulfilled, ISO `fulfilledAt`, and the roll-up counts) is a contract the app
 * depends on. This pins it.
 *
 * @see {@link file://./bookings.$bookingId.ts} loader under test
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

import { loader } from "./bookings.$bookingId";

import { assertIsDataWithResponseInit } from "../../../../test/helpers/assertions";

// @vitest-environment node

vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    // why: lifecycle-progress roll-up queries the partial-checkout log to
    // decide whether an asset was ever checked out. Not relevant to the
    // model-request serialization under test — stub to an empty log. (Survives
    // `clearAllMocks`, which clears call history but keeps implementations.)
    partialBookingCheckout: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

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

// why: booking settings + permission checks are unrelated to the model-request
// serialization under test — stub them to fixed values.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
  }),
}));
vi.mock("~/utils/permissions/permission.validator.server", () => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue("org-1");
  getMobileUserContextMock.mockResolvedValue({
    role: OrganizationRoles.ADMIN,
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: true,
  });
});

describe("GET /api/mobile/bookings/:bookingId — model requests", () => {
  it("serializes model requests with outstanding math, ISO dates and roll-up counts", async () => {
    const fulfilledDate = new Date("2026-01-02T03:04:05.000Z");
    findFirstMock.mockResolvedValue({
      id: "booking-1",
      name: "Shoot",
      description: null,
      status: "DRAFT", // DRAFT → skips getPartiallyCheckedInAssetIds
      from: null,
      to: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      creator: null,
      custodianUser: null,
      custodianTeamMember: null,
      tags: [],
      bookingAssets: [],
      modelRequests: [
        {
          id: "mr-1",
          assetModelId: "model-a",
          quantity: 3,
          fulfilledQuantity: 1,
          fulfilledAt: null,
          assetModel: { id: "model-a", name: "Dell XPS" },
        },
        {
          id: "mr-2",
          assetModelId: "model-b",
          quantity: 2,
          fulfilledQuantity: 2,
          fulfilledAt: fulfilledDate,
          assetModel: { id: "model-b", name: "Canon R5" },
        },
      ],
      _count: { bookingAssets: 0 },
    } as never);

    const response = await loader(
      createLoaderArgs({
        request: new Request(
          "http://localhost:3000/api/mobile/bookings/booking-1"
        ),
        params: { bookingId: "booking-1" },
      })
    );

    assertIsDataWithResponseInit(response);
    const body = response.data as {
      booking: {
        modelRequests: Array<{
          id: string;
          assetModelId: string;
          assetModelName: string;
          quantity: number;
          fulfilledQuantity: number;
          outstandingQuantity: number;
          fulfilledAt: string | null;
        }>;
        modelRequestCount: number;
        outstandingModelUnitCount: number;
      };
    };

    // Outstanding = quantity − fulfilled; still-open request stays open.
    expect(body.booking.modelRequests[0]).toMatchObject({
      id: "mr-1",
      assetModelName: "Dell XPS",
      quantity: 3,
      fulfilledQuantity: 1,
      outstandingQuantity: 2,
      fulfilledAt: null,
    });
    // Fully-fulfilled request: outstanding 0, ISO timestamp preserved.
    expect(body.booking.modelRequests[1]).toMatchObject({
      id: "mr-2",
      outstandingQuantity: 0,
      fulfilledAt: "2026-01-02T03:04:05.000Z",
    });
    // Roll-ups: 2 distinct models, 2 units still to assign (2 + 0).
    expect(body.booking.modelRequestCount).toBe(2);
    expect(body.booking.outstandingModelUnitCount).toBe(2);
  });

  it("returns empty model-request fields when the booking reserves no models", async () => {
    findFirstMock.mockResolvedValue({
      id: "booking-2",
      name: "Empty",
      description: null,
      status: "DRAFT",
      from: null,
      to: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      creator: null,
      custodianUser: null,
      custodianTeamMember: null,
      tags: [],
      bookingAssets: [],
      modelRequests: [],
      _count: { bookingAssets: 0 },
    } as never);

    const response = await loader(
      createLoaderArgs({
        request: new Request(
          "http://localhost:3000/api/mobile/bookings/booking-2"
        ),
        params: { bookingId: "booking-2" },
      })
    );

    assertIsDataWithResponseInit(response);
    const body = response.data as {
      booking: {
        modelRequests: unknown[];
        modelRequestCount: number;
        outstandingModelUnitCount: number;
      };
    };
    expect(body.booking.modelRequests).toEqual([]);
    expect(body.booking.modelRequestCount).toBe(0);
    expect(body.booking.outstandingModelUnitCount).toBe(0);
  });
});
