/**
 * Route action tests for `/bookings/:bookingId/activity`.
 *
 * These tests exist specifically to pin down the organization-scope guard
 * that closes the cross-organization BookingNote IDOR reported against the
 * `fix-create-note-permissions` branch. An attacker with `bookingNote.create`
 * in Org A must NOT be able to create or delete notes on a booking belonging
 * to Org B simply by knowing the target bookingId.
 *
 * Lives under `test/routes-tests/` rather than next to the route itself
 * because React Router's flat-routes scanner auto-registers any `*.ts` /
 * `*.tsx` file inside `app/routes/` as a route module and would try to
 * serve this test file to the client — crashing the dev server on its
 * server-only imports.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { action } from "~/routes/_layout+/bookings.$bookingId.activity";
import { db } from "~/database/db.server";
import * as bookingNoteService from "~/modules/booking-note/service.server";
import type * as HttpServerModule from "~/utils/http.server";
import * as httpServer from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import * as rolesServer from "~/utils/roles.server";

// @vitest-environment node

// why: exercises the route action in isolation — we are only testing the
// authorization wiring, not the DB behavior of findFirst/bookingNote.create.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findFirst: vi.fn(),
    },
  },
}));

// why: the route's authorization is what we're testing; mock permission so it
// always passes and the downstream booking lookup is the only gate.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: keep the note service from touching the DB during the action test.
vi.mock("~/modules/booking-note/service.server", () => ({
  createBookingNote: vi.fn().mockResolvedValue({}),
  deleteBookingNote: vi.fn().mockResolvedValue({ count: 1 }),
  getBookingNotes: vi.fn(),
}));

// why: avoid notification side-effects inside the test harness.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: inside the route we still rely on parseData/getParams/payload/etc. —
// mock just the param/body parsers while leaving the rest to the real module.
vi.mock("~/utils/http.server", async (importOriginal) => {
  const actual = await importOriginal<typeof HttpServerModule>();
  return {
    ...actual,
    getParams: vi.fn(),
    parseData: vi.fn(),
  };
});

const mockContext = {
  getSession: () => ({ userId: "user-attacker" }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

function makeRequest(method: "POST" | "DELETE") {
  // The route calls `await request.formData()` before our mocked `parseData`.
  // Content doesn't matter because parseData is mocked to return a fixed
  // shape, but the body must be parseable as form-encoded to avoid a runtime
  // `TypeError` from undici during `.formData()`.
  return new Request("http://localhost/bookings/victim-booking/activity", {
    method,
    body: new URLSearchParams({ _: "_" }),
  });
}

describe("bookings.$bookingId.activity action — organization scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // The attacker's session org (Org A)
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-attacker",
      isSelfServiceOrBase: false,
      organizations: [],
      currentOrganization: {} as any,
      role: {} as any,
      userOrganizations: [],
      canSeeAllBookings: false,
      canSeeAllCustody: false,
      canUseBarcodes: false,
      canUseAudits: false,
    });

    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "victim-booking",
    });
  });

  it("rejects a POST when the booking is not in the requester's organization and does NOT create a note", async () => {
    // Booking lookup scoped to attacker org returns null (bookingId belongs to Org B)
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);

    vi.mocked(httpServer.parseData).mockReturnValue({ content: "hi" });

    const response = await action(
      createActionArgs({
        request: makeRequest("POST"),
        params: { bookingId: "victim-booking" },
        context: mockContext,
      })
    );

    // Response shape: the route `makeShelfError`s and returns data(error(...), { status })
    expect((response as any).init?.status).toBe(404);

    // Cross-org bookingId must not reach the service
    expect(bookingNoteService.createBookingNote).not.toHaveBeenCalled();

    // And the booking lookup must have been scoped to the attacker's org
    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "victim-booking", organizationId: "org-attacker" },
      select: { id: true },
    });
  });

  it("rejects a DELETE when the booking is not in the requester's organization and does NOT delete a note", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);
    vi.mocked(httpServer.parseData).mockReturnValue({ noteId: "note-xyz" });

    const response = await action(
      createActionArgs({
        request: makeRequest("DELETE"),
        params: { bookingId: "victim-booking" },
        context: mockContext,
      })
    );

    expect((response as any).init?.status).toBe(404);
    expect(bookingNoteService.deleteBookingNote).not.toHaveBeenCalled();
  });

  it("creates a note and forwards organizationId to the service on the happy path", async () => {
    // Booking IS in the requester's org
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "own-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ content: "Looks good" });

    await action(
      createActionArgs({
        request: makeRequest("POST"),
        params: { bookingId: "own-booking" },
        context: mockContext,
      })
    );

    expect(bookingNoteService.createBookingNote).toHaveBeenCalledWith({
      content: "Looks good",
      userId: "user-attacker",
      bookingId: "own-booking",
      organizationId: "org-attacker",
    });
  });

  it("requests `bookingNote.create` permission on POST", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "own-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ content: "ok" });

    await action(
      createActionArgs({
        request: makeRequest("POST"),
        params: { bookingId: "own-booking" },
        context: mockContext,
      })
    );

    expect(rolesServer.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.bookingNote,
        action: PermissionAction.create,
      })
    );
  });

  it("requests `bookingNote.delete` permission on DELETE (not `create`)", async () => {
    // Guards against a regression where the DELETE branch inherited the
    // POST permission check, letting roles with only `bookingNote.create`
    // delete notes they shouldn't be able to touch.
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "own-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ noteId: "note-abc" });

    await action(
      createActionArgs({
        request: makeRequest("DELETE"),
        params: { bookingId: "own-booking" },
        context: mockContext,
      })
    );

    expect(rolesServer.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.bookingNote,
        action: PermissionAction.delete,
      })
    );
  });

  it("deletes a note and forwards organizationId to the service on the happy path", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "own-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ noteId: "note-abc" });

    await action(
      createActionArgs({
        request: makeRequest("DELETE"),
        params: { bookingId: "own-booking" },
        context: mockContext,
      })
    );

    expect(bookingNoteService.deleteBookingNote).toHaveBeenCalledWith({
      id: "note-abc",
      bookingId: "own-booking",
      userId: "user-attacker",
      organizationId: "org-attacker",
    });
  });
});
