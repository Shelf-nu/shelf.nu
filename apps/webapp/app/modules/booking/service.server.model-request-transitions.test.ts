/**
 * Transition tests for a booking's outstanding `BookingModelRequest` rows.
 *
 * A DRAFT's reservations claim nothing: `ACTIVE_BOOKING_STATUSES` covers
 * RESERVED, ONGOING and OVERDUE only, so two drafts can each promise a model's
 * entire pool. The exits from DRAFT are therefore the points that have to
 * measure those promises against the pool, and there are two of them:
 * `reserveBooking`, and `checkoutBooking` for a draft taken straight to ONGOING.
 *
 * What these tests pin is WHERE that measurement happens: inside the
 * transaction that flips the status, before the flip, with the window the
 * booking is taking and with the models the by-name guard goes on to lock. The
 * pool arithmetic itself belongs to
 * `booking-model-request/service.server.test.ts`, so the guard is a spy here.
 *
 * Lives beside `service.server.test.ts` rather than in it, which is over
 * 500 KB; the module already splits its suites by angle.
 *
 * @see {@link file://./service.server.ts} for `reserveBooking` and
 *   `checkoutBooking`
 * @see {@link file://./../booking-model-request/service.server.ts} for
 *   `assertOutstandingModelRequestsFit`
 */
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";

import { db } from "~/database/db.server";
import {
  assertModelUnitsNotReservedElsewhere,
  assertOutstandingModelRequestsFit,
} from "~/modules/booking-model-request/service.server";
import { ShelfError } from "~/utils/error";

import { checkoutBooking, reserveBooking } from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: the database is the boundary for both transitions, and what each test
// controls is the client the transaction callback is handed. `$transaction`
// therefore routes through a per-test client, installed by `openTx` below, so a
// guard that read through the outer `db` instead of `tx` would be visible.
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest
      .fn()
      .mockImplementation((callbackOrArray: unknown) =>
        typeof callbackOrArray === "function"
          ? (callbackOrArray as (tx: unknown) => unknown)(db)
          : Promise.all(callbackOrArray as Promise<unknown>[])
      ),
    // why: `lockBookingForStatusCheck` takes its lock with a raw
    // `SELECT … FOR UPDATE` and returns the status it read, which the
    // model-shaped stubs below cannot express. DRAFT by default: that is the
    // status both suites are about, and the reserve path refuses anything else.
    // A string literal, not `BookingStatus.DRAFT`, because this factory is hoisted
    // above the imports.
    $queryRaw: vitest.fn().mockResolvedValue([{ status: "DRAFT" }]),
    booking: {
      findUniqueOrThrow: vitest.fn(),
      update: vitest.fn(),
    },
    bookingAsset: {
      count: vitest.fn().mockResolvedValue(1),
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    bookingModelRequest: {
      count: vitest.fn().mockResolvedValue(1),
    },
    // why: `assertAssetsBelongToOrg` compares the row count against the ids it
    // asked for, so the stub echoes them back and the guard passes.
    asset: {
      findMany: vitest
        .fn()
        .mockImplementation((args: { where?: { id?: { in?: string[] } } }) =>
          Promise.resolve((args?.where?.id?.in ?? []).map((id) => ({ id })))
        ),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // why: kit attribution resolves memberships through the pivot. No fixture
    // here holds a kit, so none is staged.
    assetKit: { findMany: vitest.fn().mockResolvedValue([]) },
    kit: { updateMany: vitest.fn().mockResolvedValue({ count: 0 }) },
    partialBookingCheckout: {
      create: vitest.fn().mockResolvedValue({}),
      findMany: vitest.fn().mockResolvedValue([]),
    },
    teamMember: {
      findFirst: vitest.fn().mockResolvedValue({ id: "team-1" }),
    },
    userOrganization: {
      findFirst: vitest.fn().mockResolvedValue({ id: "user-org-1" }),
    },
    // why: the reserve tail schedules an auto-archive job when the workspace
    // asks for one. None of these fixtures does, so the setting reads absent.
    bookingSettings: { findUnique: vitest.fn().mockResolvedValue(null) },
  },
}));

// why: the reservation guards are the collaborators under observation. Their
// pool arithmetic is covered in booking-model-request/service.server.test.ts;
// here the tests assert which window and models each transition hands them, and
// that a refusal stops the status flip. Default: everything fits.
vitest.mock("~/modules/booking-model-request/service.server", () => ({
  assertOutstandingModelRequestsFit: vitest.fn().mockResolvedValue(undefined),
  assertModelUnitsNotReservedElsewhere: vitest
    .fn()
    .mockResolvedValue(undefined),
  assertReservationBatchWithinLimit: vitest.fn(),
  claimUnstampedBookingRows: vitest.fn().mockResolvedValue(new Map()),
  fulfilModelRequestsForAssets: vitest.fn().mockResolvedValue(new Map()),
  materializeModelRequestForAsset: vitest
    .fn()
    .mockResolvedValue({ matched: true, remaining: 0 }),
  loadActorBestEffort: vitest.fn().mockResolvedValue(null),
  writeBookingModelRequestInTx: vitest.fn(),
  // why: a factory mock replaces the whole module, so a value export the caller
  // reads has to be restated or it arrives undefined.
  RESERVATION_BATCH_TX_TIMEOUT_MS: 15_000,
}));

// why: the transitions write system notes and activity events. Both have their
// own suites; stubbing them keeps these tests to the guard's placement.
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
  createSystemBookingNotes: vitest.fn().mockResolvedValue({}),
}));
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn().mockResolvedValue({}),
}));
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    email: "custodian@example.com",
    firstName: "Test",
    lastName: "User",
    displayName: null,
  }),
}));

// why: recipient resolution and email delivery each have their own suites.
// Nobody resolves, so no mail is built for these fixtures.
vitest.mock("./notification-recipients.server", () => ({
  getBookingNotificationRecipients: vitest.fn().mockResolvedValue([]),
}));
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn().mockResolvedValue(undefined),
}));

// why: no job may reach a real queue from a unit test.
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    cancel: vitest.fn().mockResolvedValue(undefined),
    schedule: vitest.fn().mockResolvedValue(undefined),
    sendAfter: vitest.fn().mockResolvedValue(undefined),
  },
  QueueNames: {
    BOOKING_UPDATES: "booking-updates",
    bookingQueue: "booking-queue",
  },
}));

vitest.mock("~/modules/qr/service.server", () => ({
  getQr: vitest.fn(),
}));

const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const MODEL_ID = "model-1";
const OTHER_MODEL_ID = "model-0";

const hints = { timeZone: "America/New_York", locale: "en-US" };

/** A window comfortably in the future, so no reminder fires inline. */
const from = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const to = new Date(from.getTime() + 8 * 60 * 60 * 1000);

/**
 * One standalone INDIVIDUAL slice, in the shape both transitions load.
 *
 * `assetKitId: null` keeps it off the kit axis, which is what lets the kit
 * guards return without reading anything.
 */
function slice(assetId: string, assetModelId: string | null) {
  return {
    id: `ba-${assetId}`,
    assetId,
    quantity: 1,
    assetKitId: null,
    sourceKitId: null,
    checkedOutAt: null,
    checkedInAt: null,
    asset: {
      id: assetId,
      title: assetId,
      type: AssetType.INDIVIDUAL,
      status: AssetStatus.AVAILABLE,
      availableToBook: true,
      unitOfMeasure: null,
      assetModelId,
      bookingAssets: [],
      assetKits: [],
    },
  };
}

/** The booking as the outer read returns it. */
function bookingRow(
  status: BookingStatus,
  slices: ReturnType<typeof slice>[] = [slice("asset-1", MODEL_ID)]
) {
  return {
    id: BOOKING_ID,
    name: "Reserved Booking",
    description: null,
    status,
    organizationId: ORG_ID,
    creatorId: "user-1",
    custodianUserId: "user-1",
    custodianTeamMemberId: "team-1",
    custodianUser: null,
    custodianTeamMember: { name: "Team Member" },
    from,
    to,
    activeSchedulerReference: null,
    bookingAssets: slices,
    modelRequests: [],
    tags: [],
    organization: { customEmailFooter: null },
    _count: { bookingAssets: slices.length },
  };
}

/**
 * Hands the transaction callback a client of its own.
 *
 * The identity matters: with a `$transaction` mock that passes `db` through,
 * `tx.x` IS `db.x`, and moving a guard out of the transaction would leave every
 * assertion green.
 */
function openTx() {
  const tx = {
    ...db,
    booking: { ...db.booking, update: vitest.fn() },
    // A spy of its own, so a case can prove the status flip and the asset
    // flip both stayed behind a refusal.
    asset: { ...db.asset, updateMany: vitest.fn() },
  };
  // @ts-expect-error mocked
  db.$transaction.mockImplementation((callbackOrArray: unknown) =>
    typeof callbackOrArray === "function"
      ? (callbackOrArray as (client: unknown) => unknown)(tx)
      : Promise.all(callbackOrArray as Promise<unknown>[])
  );
  return tx;
}

/** Call order of a mock's first invocation, for before/after assertions. */
function firstCallOrder(mock: unknown) {
  return (mock as ReturnType<typeof vitest.fn>).mock.invocationCallOrder[0];
}

const reserveParams = {
  id: BOOKING_ID,
  name: "Reserved Booking",
  organizationId: ORG_ID,
  custodianUserId: "user-1",
  custodianTeamMemberId: "team-1",
  from,
  to,
  description: "Reserved booking description",
  hints: hints as never,
  alertsOrgOnReservation: false,
  tags: [],
};

beforeEach(() => {
  vitest.clearAllMocks();
  // `clearAllMocks` clears calls, not implementations, so the defaults the
  // factory set survive. The two that a case routinely changes are restated.
  // @ts-expect-error mocked
  db.$queryRaw.mockResolvedValue([{ status: BookingStatus.DRAFT }]);
  // @ts-expect-error mocked
  db.booking.findUniqueOrThrow.mockResolvedValue(
    bookingRow(BookingStatus.DRAFT)
  );
  // @ts-expect-error mocked
  db.bookingAsset.findMany.mockResolvedValue([]);
  // @ts-expect-error mocked
  db.asset.findMany.mockImplementation(
    (args: { where?: { id?: { in?: string[] } } }) =>
      Promise.resolve((args?.where?.id?.in ?? []).map((id) => ({ id })))
  );
  // A case that stages a refusal replaces the implementation, and
  // `clearAllMocks` does not put it back. Both guards let everything through
  // again here, or the refusal answers every later case.
  vitest.mocked(assertOutstandingModelRequestsFit).mockResolvedValue(undefined);
  vitest
    .mocked(assertModelUnitsNotReservedElsewhere)
    .mockResolvedValue(undefined);
});

describe("reserveBooking", () => {
  /** The row the status write returns, which the reserve tail reads from. */
  const reservedRow = {
    id: BOOKING_ID,
    status: BookingStatus.RESERVED,
    from,
    to,
    custodianUserId: "user-1",
  };

  it("measures the outstanding reservations in the transaction that flips the status", async () => {
    expect.assertions(3);
    const tx = openTx();
    tx.booking.update.mockResolvedValue(reservedRow);

    await reserveBooking(reserveParams);

    expect(assertOutstandingModelRequestsFit).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        organizationId: ORG_ID,
        action: "reserve booking",
        // The dates being written, which are what the booking will claim.
        from,
        to,
        tx,
      })
    );
    expect(tx.booking.update).toHaveBeenCalled();
    // Measured first: a pool read after the flip decides nothing.
    expect(firstCallOrder(assertOutstandingModelRequestsFit)).toBeLessThan(
      firstCallOrder(tx.booking.update)
    );
  });

  it("leaves the booking in DRAFT when a reservation no longer fits", async () => {
    expect.assertions(2);
    const tx = openTx();
    tx.booking.update.mockResolvedValue(reservedRow);
    vitest.mocked(assertOutstandingModelRequestsFit).mockRejectedValue(
      new ShelfError({
        cause: null,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
        message:
          "Cannot reserve booking. Some model reservations no longer fit",
      })
    );

    await expect(reserveBooking(reserveParams)).rejects.toThrow(
      "Some model reservations no longer fit"
    );
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("hands the by-name guard's models to the same lock pass, before it runs", async () => {
    expect.assertions(3);
    // @ts-expect-error mocked
    db.booking.findUniqueOrThrow.mockResolvedValue(
      bookingRow(BookingStatus.DRAFT, [
        slice("asset-1", MODEL_ID),
        slice("asset-2", OTHER_MODEL_ID),
        // A unit with no model belongs to neither guard's lock set.
        slice("asset-3", null),
      ])
    );
    const tx = openTx();
    tx.booking.update.mockResolvedValue(reservedRow);

    await reserveBooking(reserveParams);

    // Two sorted lock passes over `AssetModel` in one transaction can each hold
    // what the other waits for, so the models the by-name guard measures are
    // locked in this one. A unit with no model is in neither set.
    const [args] = vitest.mocked(assertOutstandingModelRequestsFit).mock
      .calls[0];
    expect([...(args.alsoLockAssetModelIds ?? [])].sort()).toEqual([
      OTHER_MODEL_ID,
      MODEL_ID,
    ]);
    expect(assertModelUnitsNotReservedElsewhere).toHaveBeenCalled();
    expect(firstCallOrder(assertOutstandingModelRequestsFit)).toBeLessThan(
      firstCallOrder(assertModelUnitsNotReservedElsewhere)
    );
  });
});

describe("checkoutBooking", () => {
  const checkoutParams = {
    id: BOOKING_ID,
    organizationId: ORG_ID,
    hints: hints as never,
    from,
    to,
    userId: "user-1",
  };

  it("measures a draft's outstanding reservations before it goes out", async () => {
    expect.assertions(3);
    const tx = openTx();
    tx.booking.update.mockResolvedValue({ id: BOOKING_ID });

    await checkoutBooking(checkoutParams);

    expect(assertOutstandingModelRequestsFit).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        organizationId: ORG_ID,
        action: "check out booking",
        // The booking's own committed window, as the quantity-tracked guard
        // beside it is scoped.
        from,
        to,
        tx,
      })
    );
    expect(tx.booking.update).toHaveBeenCalled();
    expect(firstCallOrder(assertOutstandingModelRequestsFit)).toBeLessThan(
      firstCallOrder(tx.booking.update)
    );
  });

  it("does not measure them again for a booking that came through RESERVED", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.booking.findUniqueOrThrow.mockResolvedValue(
      bookingRow(BookingStatus.RESERVED)
    );
    // @ts-expect-error mocked
    db.$queryRaw.mockResolvedValue([{ status: BookingStatus.RESERVED }]);
    const tx = openTx();
    tx.booking.update.mockResolvedValue({ id: BOOKING_ID });

    await checkoutBooking(checkoutParams);

    // Those units were measured on the way into RESERVED. Refusing here would
    // strand an operator over a pool that shrank for reasons the booking did
    // not cause, and the units stay open on the ongoing booking either way.
    expect(assertOutstandingModelRequestsFit).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalled();
  });

  it("sends nothing out when a draft's reservation no longer fits", async () => {
    expect.assertions(3);
    const tx = openTx();
    tx.booking.update.mockResolvedValue({ id: BOOKING_ID });
    vitest.mocked(assertOutstandingModelRequestsFit).mockRejectedValue(
      new ShelfError({
        cause: null,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
        message:
          "Cannot check out booking. Some model reservations no longer fit",
      })
    );

    await expect(checkoutBooking(checkoutParams)).rejects.toThrow(
      "Some model reservations no longer fit"
    );
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(tx.asset.updateMany).not.toHaveBeenCalled();
  });
});
