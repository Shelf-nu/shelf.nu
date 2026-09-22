/**
 * Tests for {@link fulfilAndCheckOut}: which fulfil flow runs, and that under
 * the explicit check-out requirement only the scanned units are checked out.
 *
 * @see {@link file://./fulfil-and-checkout.server.ts}
 */
import { BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import { db } from "~/database/db.server";
import {
  addScannedAssetsToBooking,
  buildKitSlicesForBooking,
  fulfilModelRequestsAndCheckout,
  partialCheckoutBooking,
} from "~/modules/booking/service.server";

import { fulfilAndCheckOut } from "./fulfil-and-checkout.server";

// @vitest-environment node

// why: the orchestrator reads the booking's status and the scanned assets
// already on the booking; the database is the boundary, and each case sets the
// rows it needs. `bookingModelRequest` is mocked so a case can stage open
// reservations and prove the orchestrator never consults them.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingAsset: { findMany: vi.fn() },
    bookingModelRequest: { findMany: vi.fn() },
  },
}));

// why: the full fulfil flow, scan-to-add and progressive check-out each have
// their own suites in service.server.test.ts; this module only chooses and
// sequences them, which is what these tests pin.
vi.mock("~/modules/booking/service.server", () => ({
  fulfilModelRequestsAndCheckout: vi.fn(),
  addScannedAssetsToBooking: vi.fn(),
  partialCheckoutBooking: vi.fn(),
  buildKitSlicesForBooking: vi.fn(),
}));

const hints = { timeZone: "Europe/Sofia", locale: "en-US" } as never;

const baseArgs = {
  bookingId: "booking-1",
  organizationId: "org-1",
  userId: "user-1",
  assetIds: ["dell-1"],
  kitIds: [],
  hints,
};

beforeEach(() => {
  vi.clearAllMocks();
  // No scanned asset is on the booking yet unless a case says otherwise.
  vi.mocked(db.bookingAsset.findMany).mockResolvedValue([]);
  // `clearAllMocks` clears calls, not implementations, so the default has to
  // be restored here or a case that stages kits leaks into the next one.
  vi.mocked(buildKitSlicesForBooking).mockResolvedValue([]);
});

/** One `AssetKit` membership, in the shape `buildKitSlicesForBooking` returns. */
function slice(assetKitId: string, assetId: string) {
  return { assetId, assetKitId, kitId: "kit-1", quantity: 1 };
}

/**
 * Stages a scanned kit holding `dell-2` and `dell-3`, with `assetKitIds`
 * naming the memberships this booking already carries.
 */
function primeScannedKit(assetKitIds: string[] = []) {
  vi.mocked(buildKitSlicesForBooking).mockResolvedValue([
    slice("ak-1", "dell-2"),
    slice("ak-2", "dell-3"),
  ]);
  // First read of the call: the kit rows already on the booking. The scanned
  // assets already assigned are read later, and keep the empty default.
  vi.mocked(db.bookingAsset.findMany).mockResolvedValueOnce(
    assetKitIds.map((assetKitId) => ({ assetKitId })) as never
  );
}

/**
 * Sets the reads of a RESERVED booking and a progressive check-out that leaves
 * two assets booked.
 */
function primeRulePath() {
  vi.mocked(db.booking.findFirst).mockResolvedValue({
    status: BookingStatus.RESERVED,
  } as never);
  vi.mocked(partialCheckoutBooking).mockResolvedValue({
    booking: {
      id: "booking-1",
      name: "Load-in",
      status: BookingStatus.ONGOING,
    },
    checkedOutAssetCount: 1,
    remainingAssetCount: 2,
    isComplete: false,
  } as never);
}

describe("fulfilAndCheckOut", () => {
  it("runs the full fulfil-and-check-out when the rule does not apply", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      status: BookingStatus.RESERVED,
    } as never);
    vi.mocked(fulfilModelRequestsAndCheckout).mockResolvedValue({
      id: "booking-1",
      name: "Load-in",
      status: BookingStatus.ONGOING,
    } as never);

    const result = await fulfilAndCheckOut({
      ...baseArgs,
      requireExplicitCheckout: false,
    });

    expect(fulfilModelRequestsAndCheckout).toHaveBeenCalledWith({
      ...baseArgs,
      kitSlices: [],
    });
    expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
    expect(partialCheckoutBooking).not.toHaveBeenCalled();
    expect(result).toEqual({
      booking: {
        id: "booking-1",
        name: "Load-in",
        status: BookingStatus.ONGOING,
      },
      remainingAssetCount: 0,
    });
  });

  it("checks out only the scanned units on a booking that is already out, even without the rule", async () => {
    // A booking some of whose items already left: sending the whole booking
    // out again would re-stamp every item. Only what was scanned goes.
    primeRulePath();
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      status: BookingStatus.ONGOING,
    } as never);

    await fulfilAndCheckOut({ ...baseArgs, requireExplicitCheckout: false });

    expect(fulfilModelRequestsAndCheckout).not.toHaveBeenCalled();
    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1"] })
    );
  });

  it("assigns the scanned units, then checks out only those, under the rule", async () => {
    primeRulePath();

    const result = await fulfilAndCheckOut({
      ...baseArgs,
      requireExplicitCheckout: true,
    });

    expect(addScannedAssetsToBooking).toHaveBeenCalledWith({
      assetIds: ["dell-1"],
      kitIds: [],
      kitSlices: [],
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(partialCheckoutBooking).toHaveBeenCalledWith({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: ["dell-1"],
      userId: "user-1",
      hints,
      intentChoice: undefined,
    });
    // Assigned before checked out: the check-out reads the assigned rows.
    expect(
      vi.mocked(addScannedAssetsToBooking).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(partialCheckoutBooking).mock.invocationCallOrder[0]
    );
    expect(fulfilModelRequestsAndCheckout).not.toHaveBeenCalled();
    expect(result).toEqual({
      booking: {
        id: "booking-1",
        name: "Load-in",
        status: BookingStatus.ONGOING,
      },
      remainingAssetCount: 2,
    });
  });

  it("answers 404 and assigns nothing when the booking is not in the workspace", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);

    await expect(
      fulfilAndCheckOut({ ...baseArgs, requireExplicitCheckout: true })
    ).rejects.toMatchObject({ status: 404 });
    expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
    expect(partialCheckoutBooking).not.toHaveBeenCalled();
  });

  it("refuses a booking that cannot be checked out, before assigning anything", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      status: BookingStatus.DRAFT,
    } as never);

    await expect(
      fulfilAndCheckOut({ ...baseArgs, requireExplicitCheckout: true })
    ).rejects.toMatchObject({ status: 400 });
    expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
  });

  it("checks out the scanned units while a reservation is still unassigned", async () => {
    primeRulePath();
    // why: the booking reserved 2 Dells and only 1 was scanned. The second
    // unit stays open on the booking instead of holding the check-out back.
    vi.mocked(db.bookingModelRequest.findMany).mockResolvedValue([
      {
        quantity: 2,
        fulfilledQuantity: 1,
        fulfilledAt: null,
        assetModel: { name: "Dell" },
      },
    ] as never);

    const result = await fulfilAndCheckOut({
      ...baseArgs,
      requireExplicitCheckout: true,
    });

    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1"] })
    );
    // Reservations are not a check-out input at all: nothing reads them.
    expect(db.bookingModelRequest.findMany).not.toHaveBeenCalled();
    expect(result.booking.status).toBe(BookingStatus.ONGOING);
  });

  it("refuses when nothing was scanned, before reading or assigning anything", async () => {
    primeRulePath();

    const refused = fulfilAndCheckOut({
      ...baseArgs,
      assetIds: [],
      requireExplicitCheckout: true,
    });

    await expect(refused).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
    });
    await expect(refused).rejects.toThrow(
      "Scan at least one item to check out."
    );
    expect(db.booking.findFirst).not.toHaveBeenCalled();
    expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
    expect(partialCheckoutBooking).not.toHaveBeenCalled();
  });

  it("a retry after a refused check-out does not re-add assigned units and still checks them out", async () => {
    primeRulePath();
    // The first attempt assigned the unit, then its check-out was refused.
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      { assetId: "dell-1" },
    ] as never);

    await fulfilAndCheckOut({ ...baseArgs, requireExplicitCheckout: true });

    expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1"] })
    );
  });

  it("assigns only the scanned units not already on the booking, and checks out all of them", async () => {
    primeRulePath();
    vi.mocked(db.bookingAsset.findMany).mockResolvedValue([
      { assetId: "dell-1" },
    ] as never);

    await fulfilAndCheckOut({
      ...baseArgs,
      assetIds: ["dell-1", "dell-2"],
      requireExplicitCheckout: true,
    });

    expect(addScannedAssetsToBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-2"] })
    );
    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1", "dell-2"] })
    );
  });

  it("adds a scanned kit's memberships and checks out every member, under the rule", async () => {
    primeRulePath();
    primeScannedKit();

    await fulfilAndCheckOut({
      ...baseArgs,
      kitIds: ["kit-1"],
      requireExplicitCheckout: true,
    });

    expect(addScannedAssetsToBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["dell-1"],
        kitIds: ["kit-1"],
        kitSlices: [slice("ak-1", "dell-2"), slice("ak-2", "dell-3")],
      })
    );
    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1", "dell-2", "dell-3"] })
    );
  });

  it("skips a membership the booking already holds, and still checks its asset out", async () => {
    primeRulePath();
    primeScannedKit(["ak-1"]);

    await fulfilAndCheckOut({
      ...baseArgs,
      kitIds: ["kit-1"],
      requireExplicitCheckout: true,
    });

    // `ak-1` is already a row on this booking, so re-adding it would collide
    // with `BookingAsset_kit_unique` and deliver nothing.
    expect(addScannedAssetsToBooking).toHaveBeenCalledWith(
      expect.objectContaining({ kitSlices: [slice("ak-2", "dell-3")] })
    );
    // Scanning a kit already on the booking is how an operator sends it out,
    // so its members leave whether this scan put them there or an earlier one.
    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1", "dell-2", "dell-3"] })
    );
  });

  it("adds an asset scanned both loose and inside a kit exactly once", async () => {
    primeRulePath();
    primeScannedKit();

    await fulfilAndCheckOut({
      ...baseArgs,
      // `dell-2` is a member of the scanned kit and was also scanned on its
      // own — one physical unit, named twice.
      assetIds: ["dell-1", "dell-2"],
      kitIds: ["kit-1"],
      requireExplicitCheckout: true,
    });

    // The kit slice owns the member. Inserting the loose row as well would
    // book the unit twice: the two partial unique indexes let a standalone row
    // and a kit-driven row coexist, so nothing at the database level refuses
    // it and every count on the booking doubles.
    expect(addScannedAssetsToBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1"] })
    );
    // It still leaves with the booking — being dropped from the add is about
    // which row carries it, not whether it goes out.
    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-1", "dell-2", "dell-3"] })
    );
  });

  it("adds a kit-only scan even though no loose asset needs assigning", async () => {
    primeRulePath();
    primeScannedKit();

    await fulfilAndCheckOut({
      ...baseArgs,
      assetIds: [],
      kitIds: ["kit-1"],
      requireExplicitCheckout: true,
    });

    expect(addScannedAssetsToBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [], kitIds: ["kit-1"] })
    );
    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["dell-2", "dell-3"] })
    );
  });

  it("resolves kit memberships in the caller's workspace", async () => {
    primeRulePath();
    primeScannedKit();

    await fulfilAndCheckOut({
      ...baseArgs,
      kitIds: ["kit-1"],
      requireExplicitCheckout: true,
    });

    // The kit id arrives from the scanner, so the membership lookup carries
    // the org scope rather than trusting it.
    expect(buildKitSlicesForBooking).toHaveBeenCalledWith({
      kitIds: ["kit-1"],
      organizationId: "org-1",
    });
  });

  it("hands the resolved slices to the full fulfil-and-check-out", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      status: BookingStatus.RESERVED,
    } as never);
    vi.mocked(fulfilModelRequestsAndCheckout).mockResolvedValue({
      id: "booking-1",
      name: "Load-in",
      status: BookingStatus.ONGOING,
    } as never);
    primeScannedKit();

    await fulfilAndCheckOut({
      ...baseArgs,
      kitIds: ["kit-1"],
      requireExplicitCheckout: false,
    });

    expect(fulfilModelRequestsAndCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        kitSlices: [slice("ak-1", "dell-2"), slice("ak-2", "dell-3")],
      })
    );
  });

  it("hands the early check-out choice to the progressive check-out", async () => {
    primeRulePath();

    await fulfilAndCheckOut({
      ...baseArgs,
      checkoutIntentChoice: CheckoutIntentEnum["with-adjusted-date"],
      requireExplicitCheckout: true,
    });

    expect(partialCheckoutBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        intentChoice: CheckoutIntentEnum["with-adjusted-date"],
      })
    );
  });

  it("scopes every read of a request-supplied id to the workspace", async () => {
    primeRulePath();

    await fulfilAndCheckOut({ ...baseArgs, requireExplicitCheckout: true });

    expect(db.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1", organizationId: "org-1" },
      })
    );
    expect(db.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          bookingId: "booking-1",
          booking: { organizationId: "org-1" },
          assetId: { in: ["dell-1"] },
          assetKitId: null,
        },
      })
    );
  });
});
