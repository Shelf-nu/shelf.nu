/**
 * Regression tests for the ownership guard on
 * `api+/bookings.$bookingId.model-requests.ts`.
 *
 * Establishes that SELF_SERVICE / BASE users (who carry `booking:update`
 * via `Role2PermissionMap`) cannot upsert or delete a model-level
 * reservation on a booking they do not own. ADMIN / OWNER bypass the
 * ownership check entirely. See hex-security report r3199039007.
 */

import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/api+/bookings.$bookingId.model-requests";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so route handlers can be invoked
// directly inside vitest without spinning up a full Remix runtime.
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

const dbMocks = vi.hoisted(() => ({
  bookingFindFirst: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  upsertBookingModelRequest: vi.fn(),
  removeBookingModelRequest: vi.fn(),
}));

// why: the route reads booking ownership rows directly via prisma; we
// inject controlled responses to drive the guard's branches.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findFirst: dbMocks.bookingFindFirst,
    },
  },
}));

// why: we never want the real permission machinery to run — each test
// supplies the (organizationId, role, isSelfServiceOrBase) it needs.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the route's success path calls into the model-request service;
// stub both verbs so the unit test stays at the route layer.
vi.mock("~/modules/booking-model-request/service.server", () => ({
  upsertBookingModelRequest: serviceMocks.upsertBookingModelRequest,
  removeBookingModelRequest: serviceMocks.removeBookingModelRequest,
}));

// why: notification side-effects are out of scope for a guard test.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: response helpers — single fetch shape returned by data().
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);

function buildRequest(method: "POST" | "DELETE", body: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(body)) {
    formData.set(key, value);
  }
  return new Request(
    "https://example.com/api/bookings/booking-1/model-requests",
    { method, body: formData }
  );
}

function buildArgs(request: Request): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-current" }),
    },
    request,
    params: { bookingId: "booking-1" },
  } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api/bookings/:bookingId/model-requests — ownership guard", () => {
  it("rejects SELF_SERVICE user upserting on someone else's booking with 403", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    dbMocks.bookingFindFirst.mockResolvedValue({
      creatorId: "someone-else",
      custodianUserId: "another-someone",
    });

    const response = (await action(
      buildArgs(
        buildRequest("POST", {
          assetModelId: "model-1",
          quantity: "3",
        })
      )
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(serviceMocks.upsertBookingModelRequest).not.toHaveBeenCalled();
  });

  it("rejects SELF_SERVICE user deleting on someone else's booking with 403", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    dbMocks.bookingFindFirst.mockResolvedValue({
      creatorId: "someone-else",
      custodianUserId: "another-someone",
    });

    const response = (await action(
      buildArgs(buildRequest("DELETE", { assetModelId: "model-1" }))
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(serviceMocks.removeBookingModelRequest).not.toHaveBeenCalled();
  });

  it("returns 404 when SELF_SERVICE hits a bookingId in another org", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    dbMocks.bookingFindFirst.mockResolvedValue(null);

    const response = (await action(
      buildArgs(
        buildRequest("POST", {
          assetModelId: "model-1",
          quantity: "1",
        })
      )
    )) as unknown as Response;

    expect(response.status).toBe(404);
    expect(serviceMocks.upsertBookingModelRequest).not.toHaveBeenCalled();
  });

  it("allows SELF_SERVICE user to upsert on their own (creator) booking", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    dbMocks.bookingFindFirst.mockResolvedValue({
      creatorId: "user-current",
      custodianUserId: null,
    });
    serviceMocks.upsertBookingModelRequest.mockResolvedValue({
      id: "req-1",
      bookingId: "booking-1",
      assetModelId: "model-1",
      quantity: 2,
    });

    const response = (await action(
      buildArgs(
        buildRequest("POST", {
          assetModelId: "model-1",
          quantity: "2",
        })
      )
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(serviceMocks.upsertBookingModelRequest).toHaveBeenCalledTimes(1);
  });

  it("allows SELF_SERVICE user when they're the custodian (not creator)", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    dbMocks.bookingFindFirst.mockResolvedValue({
      creatorId: "admin-user",
      custodianUserId: "user-current",
    });
    serviceMocks.removeBookingModelRequest.mockResolvedValue(undefined);

    const response = (await action(
      buildArgs(buildRequest("DELETE", { assetModelId: "model-1" }))
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(serviceMocks.removeBookingModelRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects BASE user manipulating someone else's booking with 403", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.BASE,
      isSelfServiceOrBase: true,
    } as any);

    dbMocks.bookingFindFirst.mockResolvedValue({
      creatorId: "someone-else",
      custodianUserId: null,
    });

    const response = (await action(
      buildArgs(
        buildRequest("POST", {
          assetModelId: "model-1",
          quantity: "1",
        })
      )
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(serviceMocks.upsertBookingModelRequest).not.toHaveBeenCalled();
  });

  it("skips the ownership probe entirely for ADMIN users", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      isSelfServiceOrBase: false,
    } as any);

    serviceMocks.upsertBookingModelRequest.mockResolvedValue({
      id: "req-2",
      bookingId: "booking-1",
      assetModelId: "model-1",
      quantity: 5,
    });

    const response = (await action(
      buildArgs(
        buildRequest("POST", {
          assetModelId: "model-1",
          quantity: "5",
        })
      )
    )) as unknown as Response;

    expect(response.status).toBe(200);
    // ADMIN must not trigger the booking ownership lookup at all.
    expect(dbMocks.bookingFindFirst).not.toHaveBeenCalled();
    expect(serviceMocks.upsertBookingModelRequest).toHaveBeenCalledTimes(1);
  });

  it("skips the ownership probe entirely for OWNER users", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.OWNER,
      isSelfServiceOrBase: false,
    } as any);

    serviceMocks.removeBookingModelRequest.mockResolvedValue(undefined);

    const response = (await action(
      buildArgs(buildRequest("DELETE", { assetModelId: "model-1" }))
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(dbMocks.bookingFindFirst).not.toHaveBeenCalled();
    expect(serviceMocks.removeBookingModelRequest).toHaveBeenCalledTimes(1);
  });
});
