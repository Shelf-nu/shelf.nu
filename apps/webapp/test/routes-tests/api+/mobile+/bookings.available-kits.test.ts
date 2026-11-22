/**
 * Tests for the mobile booking kit picker's `currentBookingId`.
 *
 * The named booking's own kits stay selectable, which reveals what it holds,
 * so the id must name a booking in the caller's workspace that the caller may
 * see. Any other id answers 404 before the kit list is read.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.available-kits.ts} route under test
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";

import { loader } from "~/routes/api+/mobile+/bookings.available-kits";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary; the route reads the named booking's
// custody links.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
  },
}));

// why: auth and entitlement are out of scope; `getMobileUserContext` is a spy
// so a test can pick the caller's role. The real module is otherwise kept.
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

// why: which kits are available is the shared kit service's job (own
// suites); here it returns a fixed page so the route's gate is the subject.
vi.mock("~/modules/kit/service.server", () => ({
  getPaginatedAndFilterableKits: vi.fn(),
}));

const listMock = vi.mocked(getPaginatedAndFilterableKits);
const bookingFindFirstMock = vi.mocked(db.booking.findFirst);

const CALLER_ID = "user-self";
const BOOKING_ID = "booking-1";

/** GET the picker, naming `currentBookingId` when given. */
function get(currentBookingId?: string) {
  const url = new URL(
    "http://localhost:3000/api/mobile/bookings/available-kits"
  );
  url.searchParams.set("orgId", "org-1");
  url.searchParams.set("bookingFrom", "2026-09-10T09:00:00.000Z");
  url.searchParams.set("bookingTo", "2026-09-12T17:00:00.000Z");
  url.searchParams.set("hideUnavailable", "true");
  if (currentBookingId) {
    url.searchParams.set("currentBookingId", currentBookingId);
  }
  return loader(createLoaderArgs({ request: new Request(url) }));
}

/** The HTTP status of a loader result (a success carries no init). */
function statusOf(result: Awaited<ReturnType<typeof get>>) {
  assertIsDataWithResponseInit(result);
  return result.init?.status ?? 200;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: CALLER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] })
  );
  listMock.mockResolvedValue({
    kits: [{ id: "kit-1", name: "Mic kit", status: "AVAILABLE" }],
    page: 1,
    perPage: 20,
    totalKits: 1,
    totalPages: 1,
  } as never);
  bookingFindFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    custodianUserId: "someone-else",
    custodianTeamMember: { userId: "someone-else" },
  } as never);
});

describe("GET /api/mobile/bookings/available-kits: currentBookingId", () => {
  it("answers 404 for a booking the caller may not see, without listing kits", async () => {
    expect(statusOf(await get(BOOKING_ID))).toBe(404);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a booking outside the caller's workspace", async () => {
    bookingFindFirstMock.mockResolvedValue(null);

    expect(statusOf(await get("booking-elsewhere"))).toBe(404);
    expect(bookingFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-elsewhere", organizationId: "org-1" },
      })
    );
    expect(listMock).not.toHaveBeenCalled();
  });

  it("lists kits against a booking the restricted caller holds", async () => {
    bookingFindFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: CALLER_ID,
      custodianTeamMember: { userId: CALLER_ID },
    } as never);

    expect(statusOf(await get(BOOKING_ID))).toBe(200);
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentBookingId: BOOKING_ID })
    );
  });

  it("lists kits against any booking for a caller who sees all bookings", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
    );

    expect(statusOf(await get(BOOKING_ID))).toBe(200);
  });

  it("reads no booking when the picker names none", async () => {
    expect(statusOf(await get())).toBe(200);
    expect(bookingFindFirstMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentBookingId: undefined })
    );
  });
});
