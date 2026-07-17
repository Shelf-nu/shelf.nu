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
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { action, loader } from "~/routes/_layout+/bookings.$bookingId.activity";
import { db } from "~/database/db.server";
import * as bookingService from "~/modules/booking/service.server";
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
  getBookingNotes: vi.fn().mockResolvedValue([]),
}));

// why: the loader's gate reads the booking `getBooking` returns; stub the
// service so the custody links under test are the only thing driving the gate.
vi.mock("~/modules/booking/service.server", () => ({
  getBooking: vi.fn(),
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

    // And the booking lookup must have been scoped to the attacker's org.
    // Both custody links are selected so the route can also gate self-service /
    // base callers to their own bookings — custody recorded on the team-member
    // link alone still belongs to the user behind it.
    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: { id: "victim-booking", organizationId: "org-attacker" },
      select: {
        id: true,
        custodianUserId: true,
        custodianTeamMember: { select: { userId: true } },
      },
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
    // The requester is this booking's custodian — the happy path for a caller
    // who may only touch their own bookings.
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
      custodianUserId: "user-attacker",
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
    // The requester is this booking's custodian — the happy path for a caller
    // who may only touch their own bookings.
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
      custodianUserId: "user-attacker",
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
    // The requester is this booking's custodian — the happy path for a caller
    // who may only touch their own bookings.
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
      custodianUserId: "user-attacker",
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
    // The requester is this booking's custodian — the happy path for a caller
    // who may only touch their own bookings.
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "own-booking",
      custodianUserId: "user-attacker",
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

  /**
   * Custody scoping is orthogonal to the organization scoping above: a booking
   * can be in the requester's own org and still not be theirs. `bookingNote`
   * `create`/`delete` reaching this far only proves the role holds the
   * permission, and BASE / SELF_SERVICE both do.
   */
  it("rejects a POST on a same-org booking the requester is not the custodian of", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "someone-elses-booking",
      custodianUserId: "user-victim",
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "someone-elses-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ content: "hi" });

    const response = await action(
      createActionArgs({
        request: makeRequest("POST"),
        params: { bookingId: "someone-elses-booking" },
        context: mockContext,
      })
    );

    expect((response as any).init?.status).toBe(403);
    expect(bookingNoteService.createBookingNote).not.toHaveBeenCalled();
  });

  /**
   * A booking assigned to the requester's team member before a user was
   * attached to it keeps `custodianUserId = NULL` forever — the index lists it
   * (its restriction matches either link) so the write gate must recognise it
   * too, or the note form on a row the user can see rejects them.
   */
  it("allows a POST on a legacy booking held via the requester's team-member link alone", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "legacy-booking",
      custodianUserId: null,
      custodianTeamMember: { userId: "user-attacker" },
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "legacy-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ content: "hi" });

    await action(
      createActionArgs({
        request: makeRequest("POST"),
        params: { bookingId: "legacy-booking" },
        context: mockContext,
      })
    );

    expect(bookingNoteService.createBookingNote).toHaveBeenCalled();
  });

  it("refuses a POST on a booking whose team-member link belongs to another user", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "someone-elses-booking",
      custodianUserId: null,
      custodianTeamMember: { userId: "user-victim" },
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "someone-elses-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ content: "hi" });

    const response = await action(
      createActionArgs({
        request: makeRequest("POST"),
        params: { bookingId: "someone-elses-booking" },
        context: mockContext,
      })
    );

    expect((response as any).init?.status).toBe(403);
    expect(bookingNoteService.createBookingNote).not.toHaveBeenCalled();
  });

  it("allows a POST on another user's booking when the requester can see all bookings", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-attacker",
      isSelfServiceOrBase: false,
      organizations: [],
      currentOrganization: {} as any,
      role: {} as any,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: false,
      canUseBarcodes: false,
      canUseAudits: false,
    });
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "someone-elses-booking",
      custodianUserId: "user-victim",
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "someone-elses-booking",
    });
    vi.mocked(httpServer.parseData).mockReturnValue({ content: "hi" });

    await action(
      createActionArgs({
        request: makeRequest("POST"),
        params: { bookingId: "someone-elses-booking" },
        context: mockContext,
      })
    );

    expect(bookingNoteService.createBookingNote).toHaveBeenCalled();
  });
});

/**
 * The loader is the read half of the same gate the action enforces on writes:
 * `bookingNote.read` is granted to BASE and SELF_SERVICE and `getBooking` is
 * org-scoped only, so without this gate any booking's activity feed — every
 * note on it — is readable by id within the workspace.
 */
describe("bookings.$bookingId.activity loader — custody scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-attacker",
      canSeeAllBookings: false,
    } as any);

    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "victim-booking",
    });
  });

  function makeLoaderRequest() {
    return new Request("http://localhost/bookings/victim-booking/activity");
  }

  it("refuses to read another user's booking activity", async () => {
    vi.mocked(bookingService.getBooking).mockResolvedValue({
      id: "victim-booking",
      name: "Victim booking",
      custodianUserId: "user-victim",
      custodianTeamMember: { userId: "user-victim" },
    } as any);

    // The loader `throw`s `data(error(...), { status })` on failure rather than
    // returning it, so the rejected value carries the status. The gate is what
    // keeps the notes from reaching the caller: the loader fetches them
    // concurrently with the booking, so they are read from the DB either way
    // and simply discarded on this path — no note content is ever returned.
    await expect(
      loader(
        createLoaderArgs({
          request: makeLoaderRequest(),
          params: { bookingId: "victim-booking" },
          context: mockContext,
        })
      )
    ).rejects.toMatchObject({ init: { status: 403 } });
  });

  it("reads the caller's own booking activity", async () => {
    vi.mocked(bookingService.getBooking).mockResolvedValue({
      id: "own-booking",
      name: "My booking",
      custodianUserId: "user-attacker",
      custodianTeamMember: null,
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "own-booking",
    });

    const response = await loader(
      createLoaderArgs({
        request: makeLoaderRequest(),
        params: { bookingId: "own-booking" },
        context: mockContext,
      })
    );

    expect((response as any).booking?.id).toBe("own-booking");
  });

  /**
   * The legacy class: custody recorded on the team-member link only. The index
   * lists these rows, so refusing them here is what made a visible booking 403
   * on click.
   */
  it("reads a legacy booking held via the caller's team-member link alone", async () => {
    vi.mocked(bookingService.getBooking).mockResolvedValue({
      id: "legacy-booking",
      name: "Legacy booking",
      custodianUserId: null,
      custodianTeamMember: { userId: "user-attacker" },
    } as any);
    vi.mocked(httpServer.getParams).mockReturnValue({
      bookingId: "legacy-booking",
    });

    const response = await loader(
      createLoaderArgs({
        request: makeLoaderRequest(),
        params: { bookingId: "legacy-booking" },
        context: mockContext,
      })
    );

    expect((response as any).booking?.id).toBe("legacy-booking");
  });

  it("reads another user's booking when the caller can see all bookings", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-attacker",
      canSeeAllBookings: true,
    } as any);
    vi.mocked(bookingService.getBooking).mockResolvedValue({
      id: "victim-booking",
      name: "Victim booking",
      custodianUserId: "user-victim",
      custodianTeamMember: { userId: "user-victim" },
    } as any);

    const response = await loader(
      createLoaderArgs({
        request: makeLoaderRequest(),
        params: { bookingId: "victim-booking" },
        context: mockContext,
      })
    );

    expect((response as any).booking?.id).toBe("victim-booking");
  });
});
