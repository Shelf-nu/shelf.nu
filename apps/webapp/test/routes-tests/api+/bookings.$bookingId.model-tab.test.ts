/**
 * Route tests for `api+/bookings.$bookingId.model-tab.ts`, the page loader of
 * the booking Models tab.
 *
 * Pins the guards it shares with the reservation writes (the booking must be
 * in the caller's workspace, and a role that may only write its own bookings
 * must own it) and the exact options it hands `getBookingModelTabData`, which
 * the Models tab relies on to read the same list the dialog loader renders.
 */

import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/api+/bookings.$bookingId.model-tab";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so the loader can be invoked directly
// inside vitest without a full router runtime.
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

const dbMocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  getBookingModelTabData: vi.fn(),
}));

// why: the route reads the booking directly; tests control whether it is in
// the workspace and who owns it.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: dbMocks.bookingFindFirst } },
}));

// why: each test supplies the caller's access through `permissionContext`.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the model list's own query logic is covered by the service tests;
// here only what the route passes in and sends back matters.
vi.mock("~/modules/booking-model-request/service.server", () => ({
  getBookingModelTabData: serviceMocks.getBookingModelTabData,
}));

// why: response helpers, single fetch shape returned by data().
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

const requirePermissionMock = vi.mocked(requirePermission);

/** The booking row the route reads, owned by `user-current` unless told. */
const BOOKING = {
  id: "booking-1",
  from: null,
  to: null,
  creatorId: "user-current",
  custodianUserId: null,
  modelRequests: [],
};

/** A page as the service returns it. */
const PAGE = {
  showModelsTab: true,
  assetModels: [],
  totalAssetModels: 3,
  matchedAssetModels: 1,
  modelsPage: 1,
  modelsPerPage: 50,
  modelRequests: [],
};

function buildArgs(query = ""): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-current" }) },
    request: new Request(
      `https://example.com/api/bookings/booking-1/model-tab${query}`
    ),
    params: { bookingId: "booking-1" },
  } as unknown as LoaderFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(
    permissionContext({
      organizationId: "org-1",
      roles: [OrganizationRoles.ADMIN],
    }) as never
  );
  dbMocks.bookingFindFirst.mockResolvedValue(BOOKING);
  serviceMocks.getBookingModelTabData.mockResolvedValue(PAGE);
});

describe("api/bookings/:bookingId/model-tab", () => {
  it("reads the page the query asks for, pinned and clamped like the dialog", async () => {
    const response = (await loader(
      buildArgs("?modelSearch=dell&modelPage=2&showEmptyModels=true")
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(serviceMocks.getBookingModelTabData).toHaveBeenCalledWith({
      organizationId: "org-1",
      booking: BOOKING,
      search: "dell",
      page: 2,
      showModelsWithoutAssets: true,
      clampPageToResults: true,
      pinReservedModels: true,
    });
    const body = await response.json();
    expect(body).toMatchObject({ matchedAssetModels: 1, error: null });
  });

  it("scopes the booking to the caller's workspace and 404s outside it", async () => {
    dbMocks.bookingFindFirst.mockResolvedValue(null);

    const response = (await loader(buildArgs())) as unknown as Response;

    expect(dbMocks.bookingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1", organizationId: "org-1" },
      })
    );
    expect(response.status).toBe(404);
    expect(serviceMocks.getBookingModelTabData).not.toHaveBeenCalled();
  });

  it("refuses a self-service member a booking they do not own", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({
        organizationId: "org-1",
        roles: [OrganizationRoles.SELF_SERVICE],
      }) as never
    );
    dbMocks.bookingFindFirst.mockResolvedValue({
      ...BOOKING,
      creatorId: "someone-else",
      custodianUserId: "another-someone",
    });

    const response = (await loader(buildArgs())) as unknown as Response;

    expect(response.status).toBe(403);
    expect(serviceMocks.getBookingModelTabData).not.toHaveBeenCalled();
  });
});
