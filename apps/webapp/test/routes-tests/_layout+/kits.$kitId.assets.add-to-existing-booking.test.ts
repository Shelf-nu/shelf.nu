/**
 * Route tests for adding a kit to an existing booking FROM THE KIT'S PAGE.
 *
 * The invariant under test is that this door and the booking-page door
 * (`manage-kits`) leave the same audit trail. They did not: this route forwards
 * a non-empty `kitIds` to `updateBookingAssets`, which suppresses the service's
 * own booking-side note on the assumption that a kit caller writes its own.
 * `manage-kits` does; this route did not. So adding a kit here recorded nothing
 * at all in the booking's activity feed, while the identical action from the
 * booking's own page recorded it properly.
 *
 * That is the inverse of the duplicate-note defect fixed alongside it — same
 * root design fault (`kitIds` standing in for "the caller owns the note"),
 * opposite symptom.
 *
 * @see {@link file://./../../../app/routes/_layout+/kits.$kitId.assets.add-to-existing-booking.tsx}
 * @see {@link file://./bookings.$bookingId.overview.manage-kits.test.ts} — the door that was already correct
 */
import { BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import * as bookingService from "~/modules/booking/service.server";
import * as httpServer from "~/utils/http.server";

import { action } from "~/routes/_layout+/kits.$kitId.assets.add-to-existing-booking";

// @vitest-environment node

vi.mock("~/database/db.server", () => ({
  db: {
    kit: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/modules/booking/service.server", () => ({
  assertKitsAddableToActiveBooking: vi.fn(),
  buildKitSlicesForBooking: vi.fn(),
  createKitBookingNote: vi.fn(),
  getExistingBookingDetails: vi.fn(),
  loadBookingsData: vi.fn(),
  updateBookingAssets: vi.fn(),
}));

vi.mock("~/modules/note/service.server", () => ({
  createNotes: vi.fn(),
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user123",
    firstName: "John",
    lastName: "Doe",
  }),
}));

vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("cookie"),
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    organizationId: "org123",
    role: "OWNER",
  }),
}));

vi.mock("~/utils/booking-authorization.server", () => ({
  validateBookingOwnership: vi.fn(),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("~/utils/http.server", async (importOriginal) => {
  const actual = await importOriginal<typeof httpServer>();
  return {
    ...actual,
    getParams: vi.fn(() => ({ kitId: "kit123" })),
    parseData: vi.fn(() => ({
      kitIds: ["kit123"],
      bookingId: "booking123",
    })),
    payload: vi.fn((data) => ({ error: null, ...data })),
    error: vi.fn((reason) => reason),
  };
});

const mockContext = {
  getSession: () => ({ userId: "user123" }),
} as any;

// why: a real `new Request(url, {method:"POST"})` has no body, so `.formData()`
// rejects and the action's catch swallows it before any assertion can fire.
const mockRequest = {
  formData: () => Promise.resolve(new FormData()),
  headers: new Headers(),
  method: "POST",
  url: "http://localhost",
} as any;

describe("adding a kit to a booking from the kit page", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(bookingService.getExistingBookingDetails).mockResolvedValue({
      id: "booking123",
      name: "Autumn Shoot",
      status: BookingStatus.DRAFT,
      creatorId: "user123",
      custodianUserId: "user123",
      bookingAssets: [],
    } as any);

    // One membership resolved for the kit being added.
    vi.mocked(bookingService.buildKitSlicesForBooking).mockResolvedValue([
      { assetId: "asset1", assetKitId: "assetkit1", quantity: 1 },
    ] as any);

    vi.mocked(bookingService.updateBookingAssets).mockResolvedValue({
      id: "booking123",
      name: "Autumn Shoot",
    } as any);

    vi.mocked(db.kit.findMany).mockResolvedValue([
      { id: "kit123", name: "Lighting Kit" },
    ] as any);
  });

  it("records the kit add in the booking's activity feed", async () => {
    expect.assertions(2);

    await action(
      createActionArgs({
        context: mockContext,
        params: { kitId: "kit123" },
        request: mockRequest,
      })
    );

    // Without this call the booking's feed says NOTHING happened, because the
    // non-empty `kitIds` below suppresses the service's own note.
    expect(bookingService.createKitBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking123",
        organizationId: "org123",
        kitIds: ["kit123"],
        userId: "user123",
        action: "added",
      })
    );

    // Names, not bare ids: `createKitBookingNote` falls back to an id-only
    // `kits_list` tag when `kits` is omitted, which would make this door's note
    // read differently from the booking-page door's for the same action.
    expect(
      vi.mocked(bookingService.createKitBookingNote).mock.calls[0][0].kits
    ).toEqual([{ id: "kit123", name: "Lighting Kit" }]);
  });

  it("scopes the kit-name lookup to the caller's organization", async () => {
    expect.assertions(1);

    await action(
      createActionArgs({
        context: mockContext,
        params: { kitId: "kit123" },
        request: mockRequest,
      })
    );

    // `kitIds` is request-supplied, so an unscoped read would let a caller in
    // one org resolve another org's kit names into their booking note.
    expect(db.kit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["kit123"] }, organizationId: "org123" },
      })
    );
  });

  it("still forwards kitIds, so the service does not add a second note", async () => {
    expect.assertions(1);

    await action(
      createActionArgs({
        context: mockContext,
        params: { kitId: "kit123" },
        request: mockRequest,
      })
    );

    // The route and the service must not BOTH write. `kitIds` being non-empty
    // is what suppresses the service's copy — dropping it here would trade the
    // missing-note bug for the duplicate-note bug.
    expect(
      vi.mocked(bookingService.updateBookingAssets).mock.calls[0][0].kitIds
    ).toEqual(["kit123"]);
  });
});
