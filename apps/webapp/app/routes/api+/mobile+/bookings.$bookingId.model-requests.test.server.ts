/**
 * Security + verb-routing tests for the mobile Book-by-Model mutation endpoint.
 *
 * The shared services (`upsertBookingModelRequest` /
 * `removeBookingModelRequest`) org-scope the booking but do NOT check custodian
 * ownership, so the ROUTE must: a SELF_SERVICE / BASE user may only edit model
 * reservations on a booking THEY own — otherwise it's a cross-user IDOR within
 * the org (the exact class the web twin guards against). These tests pin that
 * guard plus POST→upsert / DELETE→remove routing.
 *
 * @see {@link file://./bookings.$bookingId.model-requests.ts} route under test
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  removeBookingModelRequest,
  upsertBookingModelRequest,
} from "~/modules/booking-model-request/service.server";

import { action } from "./bookings.$bookingId.model-requests";

import { assertIsDataWithResponseInit } from "../../../../test/helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary — we assert the route reads the booking's
// custodianUserId to gate the mutation. Mock only booking.findFirst.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: auth/permission/entitlement helpers are out of scope for these guard
// tests — stub them to resolve, but keep `getMobileUserContext` a spy so each
// test can pick the caller's role. The real module is otherwise preserved.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    requireMobilePermission: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

// why: rate limiting is infra, not the behavior under test — no-op it.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// why: the services are the seam the route delegates to; spying on them lets us
// assert the route BLOCKS the call for a non-owner and FORWARDS it for an owner.
vi.mock("~/modules/booking-model-request/service.server", () => ({
  upsertBookingModelRequest: vi.fn(),
  removeBookingModelRequest: vi.fn(),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);
const upsertMock = vi.mocked(upsertBookingModelRequest);
const removeMock = vi.mocked(removeBookingModelRequest);

const CALLER_ID = "user-self";
const OTHER_ID = "user-other";
const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const MODEL_ID = "model-1";

/** Build an action request for this endpoint with a JSON body + verb. */
function makeArgs(method: "POST" | "DELETE", body: Record<string, unknown>) {
  return createActionArgs({
    request: new Request(
      `http://localhost:3000/api/mobile/bookings/${BOOKING_ID}/model-requests`,
      {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    ),
    params: { bookingId: BOOKING_ID },
  });
}

/** Point `getMobileUserContext` at a specific role for the next call. */
function withRole(role: OrganizationRoles) {
  getMobileUserContextMock.mockResolvedValue({
    role,
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: CALLER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(ORG_ID);
  upsertMock.mockResolvedValue({ id: "req-1" } as never);
  removeMock.mockResolvedValue(undefined as never);
});

describe("POST/DELETE /api/mobile/bookings/:bookingId/model-requests", () => {
  it("403s a SELF_SERVICE user editing a booking they do not own, without calling the service", async () => {
    withRole(OrganizationRoles.SELF_SERVICE);
    // Booking is owned by someone else.
    findFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: OTHER_ID,
    } as never);

    const response = await action(
      makeArgs("POST", { assetModelId: MODEL_ID, quantity: 2 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(403);
    // The IDOR guard must fire BEFORE the service is reached.
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("403s a BASE user the same way (BASE is as restricted as SELF_SERVICE)", async () => {
    withRole(OrganizationRoles.BASE);
    findFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: OTHER_ID,
    } as never);

    const response = await action(
      makeArgs("DELETE", { assetModelId: MODEL_ID })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(403);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("lets a SELF_SERVICE user reserve on a booking they own (POST → upsert)", async () => {
    withRole(OrganizationRoles.SELF_SERVICE);
    findFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: CALLER_ID, // owns it
    } as never);

    const response = await action(
      makeArgs("POST", { assetModelId: MODEL_ID, quantity: 3 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({ success: true });
    expect(upsertMock).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      organizationId: ORG_ID,
      userId: CALLER_ID,
    });
  });

  it("lets an ADMIN edit any booking's reservation (no custodian restriction)", async () => {
    withRole(OrganizationRoles.ADMIN);
    findFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: OTHER_ID, // not the admin — allowed anyway
    } as never);

    const response = await action(
      makeArgs("POST", { assetModelId: MODEL_ID, quantity: 1 })
    );

    assertIsDataWithResponseInit(response);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it("routes DELETE to removeBookingModelRequest", async () => {
    withRole(OrganizationRoles.OWNER);
    findFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: OTHER_ID,
    } as never);

    const response = await action(
      makeArgs("DELETE", { assetModelId: MODEL_ID })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({ success: true });
    expect(removeMock).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      userId: CALLER_ID,
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("404s when the booking is not in the caller's workspace", async () => {
    withRole(OrganizationRoles.ADMIN);
    findFirstMock.mockResolvedValue(null);

    const response = await action(
      makeArgs("POST", { assetModelId: MODEL_ID, quantity: 1 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("400s on an invalid body (validation), not 500, without calling the service", async () => {
    withRole(OrganizationRoles.ADMIN);
    findFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      custodianUserId: CALLER_ID,
    } as never);

    // quantity 0 fails UpsertSchema (.positive) → must be a 400, not a raw
    // ZodError that makeShelfError would surface as a 500.
    const response = await action(
      makeArgs("POST", { assetModelId: MODEL_ID, quantity: 0 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
