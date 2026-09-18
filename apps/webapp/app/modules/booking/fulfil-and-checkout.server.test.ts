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
  fulfilModelRequestsAndCheckout,
  partialCheckoutBooking,
} from "~/modules/booking/service.server";

import { fulfilAndCheckOut } from "./fulfil-and-checkout.server";

// @vitest-environment node

// why: the orchestrator reads the booking's status, the scanned assets already
// on the booking, and its model requests; the database is the boundary, and
// each case sets the rows it needs.
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
});

/**
 * Sets the reads of a RESERVED booking whose reservations are all assigned
 * after the scan, and a progressive check-out that leaves two assets booked.
 */
function primeRulePath() {
  vi.mocked(db.booking.findFirst).mockResolvedValue({
    status: BookingStatus.RESERVED,
  } as never);
  vi.mocked(db.bookingModelRequest.findMany).mockResolvedValue([
    {
      quantity: 1,
      fulfilledQuantity: 1,
      fulfilledAt: new Date(),
      assetModel: { name: "Dell" },
    },
  ] as never);
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
    vi.mocked(fulfilModelRequestsAndCheckout).mockResolvedValue({
      id: "booking-1",
      name: "Load-in",
      status: BookingStatus.ONGOING,
    } as never);

    const result = await fulfilAndCheckOut({
      ...baseArgs,
      requireExplicitCheckout: false,
    });

    expect(fulfilModelRequestsAndCheckout).toHaveBeenCalledWith(baseArgs);
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

  it("assigns the scanned units, then checks out only those, under the rule", async () => {
    primeRulePath();

    const result = await fulfilAndCheckOut({
      ...baseArgs,
      requireExplicitCheckout: true,
    });

    expect(addScannedAssetsToBooking).toHaveBeenCalledWith({
      assetIds: ["dell-1"],
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

  it("does not check out while a reservation is still unassigned after the scan", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      status: BookingStatus.RESERVED,
    } as never);
    vi.mocked(db.bookingModelRequest.findMany).mockResolvedValue([
      {
        quantity: 2,
        fulfilledQuantity: 1,
        fulfilledAt: null,
        assetModel: { name: "Dell" },
      },
    ] as never);

    const refused = fulfilAndCheckOut({
      ...baseArgs,
      requireExplicitCheckout: true,
    });

    await expect(refused).rejects.toMatchObject({ status: 400 });
    await expect(refused).rejects.toThrow(/1 × Dell still unassigned/);
    expect(addScannedAssetsToBooking).toHaveBeenCalledTimes(1);
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

  it("refuses a kit scan under the rule before reading, assigning or checking out anything", async () => {
    const refused = fulfilAndCheckOut({
      ...baseArgs,
      kitIds: ["kit-1"],
      requireExplicitCheckout: true,
    });

    await expect(refused).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
    });
    await expect(refused).rejects.toThrow(
      "Kits can't be checked out from the reservation scanner. Use Scan to check out for kits."
    );
    expect(db.booking.findFirst).not.toHaveBeenCalled();
    expect(db.bookingAsset.findMany).not.toHaveBeenCalled();
    expect(db.bookingModelRequest.findMany).not.toHaveBeenCalled();
    expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
    expect(partialCheckoutBooking).not.toHaveBeenCalled();
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
    expect(db.bookingModelRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "booking-1", booking: { organizationId: "org-1" } },
      })
    );
  });
});
