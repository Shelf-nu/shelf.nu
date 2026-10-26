/**
 * Bulk check-out and check-in from the bookings list.
 *
 * Both functions validate the whole selection before the first write and
 * then hand each booking to the one-click service the booking page uses.
 * Those services are mocked here: what this suite pins is the batch rule
 * around them (status refusal, ownership refusal, the check-out-only refusals
 * for unassigned units and from-location questions, the explicit-mode guard),
 * the arguments each booking is handed (dates kept, web quick provenance), the
 * asset notes, and how a mid-batch failure is reported.
 *
 * @see {@link file://./bulk-check-in-out.server.ts}
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { db } from "~/database/db.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { createNotes } from "~/modules/note/service.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  bulkCheckinBookings,
  bulkCheckoutBookings,
  listBookingNames,
} from "./bulk-check-in-out.server";
import { getCheckoutSourceQuestions } from "./checkout-source-location.server";
import {
  assertSelectAllWithinOwnership,
  checkinBooking,
  checkoutBooking,
  getBulkBookingsWhereInput,
} from "./service.server";

// @vitest-environment node

// why: the selection query and the "which assets are out" read are the two
// database reads this module makes itself; everything else goes through the
// mocked services below.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findMany: vi.fn() },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: the one-click services each take their own locked transaction with
// hundreds of lines of guards; the subject here is the batch around them.
vi.mock("./service.server", () => ({
  checkoutBooking: vi.fn(),
  checkinBooking: vi.fn(),
  getBulkBookingsWhereInput: vi.fn().mockResolvedValue({}),
  assertSelectAllWithinOwnership: vi.fn(),
}));

// why: the explicit scan switches are a settings row; drive them per test.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: the from-location question needs placement rows; the batch only asks
// whether there is one.
vi.mock("./checkout-source-location.server", () => ({
  getCheckoutSourceQuestions: vi.fn().mockResolvedValue([]),
}));

// why: the notes are asserted on as calls, not written.
vi.mock("~/modules/note/service.server", () => ({
  createNotes: vi.fn(),
}));

// why: the actor's name feeds the note text only.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Jane",
    lastName: "Doe",
    displayName: null,
  }),
}));

const ORG = "org-1";
const ME = "user-1";
const HINTS = { timeZone: "UTC", locale: "en-US" };

const NO_EXPLICIT_SCAN = {
  requireExplicitCheckoutForAdmin: false,
  requireExplicitCheckoutForSelfService: false,
  requireExplicitCheckinForAdmin: false,
  requireExplicitCheckinForSelfService: false,
};

const findManyMock = vi.mocked(db.booking.findMany);
const assetFindManyMock = vi.mocked(db.asset.findMany);
const settingsMock = vi.mocked(getBookingSettingsForOrganization);
const checkoutMock = vi.mocked(checkoutBooking);
const checkinMock = vi.mocked(checkinBooking);
const questionsMock = vi.mocked(getCheckoutSourceQuestions);
const notesMock = vi.mocked(createNotes);

/** One selected booking as the selection query returns it. */
function selected(
  id: string,
  status: BookingStatus,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    name: `Booking ${id}`,
    status,
    from: new Date("2026-08-01T09:00:00Z"),
    to: new Date("2026-08-05T17:00:00Z"),
    modelRequests: [],
    ...overrides,
  };
}

/** The arguments every call in this suite shares, for an unrestricted caller. */
function args(
  bookingIds: string[],
  role: OrganizationRoles = OrganizationRoles.ADMIN
) {
  return {
    bookingIds,
    organizationId: ORG,
    userId: ME,
    hints: HINTS,
    access: accessFor([role]),
  };
}

/** What the service returns after a successful check-out or check-in. */
function processed(id: string, assetIds: string[]) {
  return {
    id,
    name: `Booking ${id}`,
    bookingAssets: assetIds.map((assetId) => ({ assetId })),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue(NO_EXPLICIT_SCAN as never);
  questionsMock.mockResolvedValue([]);
  assetFindManyMock.mockResolvedValue([]);
  vi.mocked(getBulkBookingsWhereInput).mockResolvedValue({});
});

describe("listBookingNames", () => {
  it("quotes and joins a few names", () => {
    expect(listBookingNames(["A", "B", "C"])).toBe('"A", "B" and "C"');
  });

  it("names at most five and counts the rest", () => {
    expect(listBookingNames(["A", "B", "C", "D", "E", "F", "G"])).toBe(
      '"A", "B", "C", "D", "E" and 2 more bookings'
    );
  });
});

describe("bulkCheckoutBookings", () => {
  it("checks every RESERVED booking out in order, keeping the start date, and writes the asset note", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.RESERVED),
      selected("b2", BookingStatus.RESERVED),
    ] as never);
    checkoutMock
      .mockResolvedValueOnce(processed("b1", ["a1", "a2"]))
      .mockResolvedValueOnce(processed("b2", []));

    await bulkCheckoutBookings(args(["b1", "b2"]));

    expect(checkoutMock.mock.calls.map(([call]) => call.id)).toEqual([
      "b1",
      "b2",
    ]);
    expect(checkoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "b1",
        organizationId: ORG,
        userId: ME,
        hints: HINTS,
        intentChoice: "without-adjusted-date",
        from: new Date("2026-08-01T09:00:00Z"),
        to: new Date("2026-08-05T17:00:00Z"),
        provenance: { surface: "web", method: "quick" },
      })
    );
    // One note per booking that has assets; b2 has none.
    expect(notesMock).toHaveBeenCalledTimes(1);
    expect(notesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["a1", "a2"],
        organizationId: ORG,
        type: "UPDATE",
        content: expect.stringContaining("checked out asset with"),
      })
    );
  });

  it("refuses the whole batch, naming the bookings, when one is not RESERVED", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.RESERVED),
      selected("b2", BookingStatus.DRAFT),
    ] as never);

    await expect(bulkCheckoutBookings(args(["b1", "b2"]))).rejects.toThrow(
      /"Booking b2" is not reserved.*Nothing was changed/
    );
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("refuses the whole batch when a booking still has unassigned model units", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.RESERVED, {
        modelRequests: [
          { quantity: 3, fulfilledQuantity: 1, fulfilledAt: null },
        ],
      }),
      selected("b2", BookingStatus.RESERVED),
    ] as never);

    await expect(bulkCheckoutBookings(args(["b1", "b2"]))).rejects.toThrow(
      /"Booking b1" still has reserved units with no asset assigned/
    );
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("refuses the whole batch when a booking needs a from-location choice", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.RESERVED),
      selected("b2", BookingStatus.RESERVED),
    ] as never);
    questionsMock.mockImplementation(({ bookingId }) =>
      Promise.resolve(bookingId === "b2" ? [{ sliceId: "s1" } as never] : [])
    );

    await expect(bulkCheckoutBookings(args(["b1", "b2"]))).rejects.toThrow(
      /"Booking b2" needs a from-location choice/
    );
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("refuses the whole batch with 403 when the workspace requires explicit check-out for the caller", async () => {
    settingsMock.mockResolvedValue({
      ...NO_EXPLICIT_SCAN,
      requireExplicitCheckoutForAdmin: true,
    } as never);
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.RESERVED),
    ] as never);

    await expect(bulkCheckoutBookings(args(["b1"]))).rejects.toMatchObject({
      status: 403,
    });
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("refuses a restricted caller whose explicit selection reaches a booking the scope dropped", async () => {
    // The ownership-scoped query returns only the caller's own booking.
    findManyMock.mockResolvedValue([
      selected("mine", BookingStatus.RESERVED),
    ] as never);

    await expect(
      bulkCheckoutBookings(
        args(["mine", "theirs"], OrganizationRoles.SELF_SERVICE)
      )
    ).rejects.toMatchObject({
      status: 403,
      message: "You can only check out bookings you created or hold.",
    });
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("hands a select-all to the ownership assert with the list it stands for", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.RESERVED),
    ] as never);
    checkoutMock.mockResolvedValue(processed("b1", []));

    await bulkCheckoutBookings({
      ...args([ALL_SELECTED_KEY], OrganizationRoles.SELF_SERVICE),
      list: { kind: "index" },
      currentSearchParams: "status=RESERVED",
    });

    expect(assertSelectAllWithinOwnership).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingIds: [ALL_SELECTED_KEY],
        matchedCount: 1,
        list: { kind: "index" },
        currentSearchParams: "status=RESERVED",
        action: "check out",
      })
    );
  });

  it("stops at the first booking that fails and says how many were done", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.RESERVED),
      selected("b2", BookingStatus.RESERVED),
      selected("b3", BookingStatus.RESERVED),
    ] as never);
    checkoutMock
      .mockResolvedValueOnce(processed("b1", []))
      .mockRejectedValueOnce(
        new ShelfError({
          cause: null,
          message: "Some assets are already checked out on another booking.",
          label: "Booking",
          status: 400,
        })
      );

    await expect(
      bulkCheckoutBookings(args(["b1", "b2", "b3"]))
    ).rejects.toThrow(
      '"Booking b2": Some assets are already checked out on another booking. The 1 booking before it was checked out. The 1 booking after it was not touched.'
    );
    expect(checkoutMock).toHaveBeenCalledTimes(2);
  });
});

describe("bulkCheckinBookings", () => {
  it("checks every ONGOING or OVERDUE booking in, keeping the end date, with a note for the assets that were out", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.ONGOING),
      selected("b2", BookingStatus.OVERDUE),
    ] as never);
    assetFindManyMock
      .mockResolvedValueOnce([{ id: "a1" }] as never)
      .mockResolvedValueOnce([] as never);
    checkinMock
      .mockResolvedValueOnce(processed("b1", ["a1"]))
      .mockResolvedValueOnce(processed("b2", ["a9"]));

    await bulkCheckinBookings(args(["b1", "b2"]));

    expect(checkinMock.mock.calls.map(([call]) => call.id)).toEqual([
      "b1",
      "b2",
    ]);
    expect(checkinMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "b1",
        organizationId: ORG,
        userId: ME,
        intentChoice: "without-adjusted-date",
        provenance: { surface: "web", method: "quick" },
      })
    );
    // b2's asset was never checked out, so only b1 gets a note.
    expect(notesMock).toHaveBeenCalledTimes(1);
    expect(notesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["a1"],
        content: expect.stringContaining("checked in asset with"),
      })
    );
  });

  it("refuses the whole batch, naming the bookings, when one is not in progress", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.ONGOING),
      selected("b2", BookingStatus.RESERVED),
      selected("b3", BookingStatus.COMPLETE),
    ] as never);

    await expect(bulkCheckinBookings(args(["b1", "b2", "b3"]))).rejects.toThrow(
      /"Booking b2" and "Booking b3" are not in progress.*Nothing was changed/
    );
    expect(checkinMock).not.toHaveBeenCalled();
  });

  it("refuses the whole batch with 403 when the workspace requires explicit check-in for the caller", async () => {
    settingsMock.mockResolvedValue({
      ...NO_EXPLICIT_SCAN,
      requireExplicitCheckinForSelfService: true,
    } as never);
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.ONGOING),
    ] as never);

    await expect(
      bulkCheckinBookings(args(["b1"], OrganizationRoles.SELF_SERVICE))
    ).rejects.toMatchObject({ status: 403 });
    expect(checkinMock).not.toHaveBeenCalled();
  });

  it("refuses a restricted caller whose explicit selection reaches a booking the scope dropped", async () => {
    findManyMock.mockResolvedValue([
      selected("mine", BookingStatus.ONGOING),
    ] as never);

    await expect(
      bulkCheckinBookings(
        args(["mine", "theirs"], OrganizationRoles.SELF_SERVICE)
      )
    ).rejects.toMatchObject({
      status: 403,
      message: "You can only check in bookings you created or hold.",
    });
    expect(checkinMock).not.toHaveBeenCalled();
  });

  it("stops at the first booking that fails and leaves the rest untouched", async () => {
    findManyMock.mockResolvedValue([
      selected("b1", BookingStatus.ONGOING),
      selected("b2", BookingStatus.ONGOING),
    ] as never);
    checkinMock.mockRejectedValueOnce(new Error("connection lost"));

    await expect(bulkCheckinBookings(args(["b1", "b2"]))).rejects.toThrow(
      '"Booking b1": Something went wrong while it was being checked in. No booking was changed. The 1 booking after it was not touched.'
    );
    expect(checkinMock).toHaveBeenCalledTimes(1);
  });
});
