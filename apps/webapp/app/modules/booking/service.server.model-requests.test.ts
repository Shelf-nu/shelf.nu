/**
 * Model-reservation tests for `createBooking`.
 *
 * A booking created from the model view holds `BookingModelRequest` rows —
 * units of an `AssetModel` promised to it without naming which physical assets
 * will serve them. The single thing these tests defend is that the booking and
 * those reservations share one transaction: a booking that commits while a
 * reservation fails is a promise nobody recorded, and it renders as a perfectly
 * healthy empty booking, so nothing downstream can report it.
 *
 * The db mock therefore models commit and rollback rather than just resolving:
 * rows created inside a `$transaction` callback are only published to the
 * committed log once that callback resolves.
 *
 * Lives beside `service.server.test.ts` rather than in it — that file is 556 KB,
 * and the module already splits its suites by angle.
 *
 * @see {@link file://./service.server.ts} — `createBooking`
 * @see {@link file://./../booking-model-request/service.server.ts} —
 *   `writeBookingModelRequestInTx`, the transaction-accepting write core
 */
import type { Mock } from "vitest";

import { db } from "~/database/db.server";
import {
  loadActorBestEffort,
  writeBookingModelRequestInTx,
} from "~/modules/booking-model-request/service.server";
import { ShelfError } from "~/utils/error";
import { createBooking } from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: `createBooking` runs real Prisma writes, but what is under test is
// WHERE the reservation writes happen, not what a database returns. The mock
// models the transaction boundary itself: each `$transaction` call hands the
// callback a fresh client whose `booking.create` buffers the row, and the
// buffer is published to the committed log only after the callback resolves.
// A throw skips that step, which is exactly what a rollback means here — so
// "no booking was created" becomes an assertion rather than an assumption.
vitest.mock("~/database/db.server", () => {
  /** Bookings whose transaction callback ran to completion. */
  let _committedBookings: { id: string }[] = [];

  /** The transaction client handed to the most recent `$transaction` callback. */
  let _lastTx: unknown = null;

  let _bookingSeq = 0;

  /**
   * Builds one transaction-scoped client plus the buffer its writes land in.
   *
   * A fresh object per transaction is what lets a test prove the reservation
   * write received the SAME client that created the booking — identity is the
   * only evidence that survives mocking.
   */
  const openTx = () => {
    const pending: { id: string }[] = [];
    const tx = {
      booking: {
        create: vitest.fn().mockImplementation(() => {
          _bookingSeq += 1;
          const row = { id: `booking-${_bookingSeq}` };
          pending.push(row);
          return Promise.resolve(row);
        }),
      },
      // why: the per-asset `BOOKING_ASSETS_ADDED` events look up each asset's
      // type/unitOfMeasure through the transaction client. No rows needed —
      // the events themselves are mocked out below.
      asset: {
        findMany: vitest.fn().mockResolvedValue([]),
      },
    };
    return { tx, pending };
  };

  return {
    db: {
      $transaction: vitest
        .fn()
        .mockImplementation(async (callbackOrArray: unknown) => {
          if (typeof callbackOrArray !== "function") {
            return Promise.all(callbackOrArray as Promise<unknown>[]);
          }
          const { tx, pending } = openTx();
          _lastTx = tx;
          const result = await (callbackOrArray as (t: unknown) => unknown)(tx);
          // Reached only when the callback resolved. A throw propagates past
          // this line and the buffered rows are discarded — the rollback.
          _committedBookings.push(...pending);
          return result;
        }),
      // why: the INDIVIDUAL standalone/kit-slice overlap probe reads asset
      // types before the transaction opens. These tests pass no kit slices, so
      // it never runs; the stub is here so a future overlap case does not fail
      // for the wrong reason.
      asset: {
        findMany: vitest.fn().mockResolvedValue([]),
      },
      /** Bookings that survived their transaction. */
      __committedBookings: () => _committedBookings,
      /** The client the most recent transaction handed its callback. */
      __lastTx: () => _lastTx,
      /** Per-test escape hatch; invoked from `beforeEach`. */
      __reset: () => {
        _committedBookings = [];
        _lastTx = null;
      },
    },
  };
});

// why: the reservation write core is the collaborator under observation — the
// point of these tests is which transaction it is handed and what it is asked
// to write, not the availability arithmetic it performs (that is covered in
// `booking-model-request/service.server.test.ts`). `createBooking` also imports
// two other symbols from this module, so they are stubbed to keep the module
// mock total.
vitest.mock("~/modules/booking-model-request/service.server", () => ({
  writeBookingModelRequestInTx: vitest.fn(),
  loadActorBestEffort: vitest.fn(),
  assertModelUnitsNotReservedElsewhere: vitest
    .fn()
    .mockResolvedValue(undefined),
  fulfilModelRequestsForAssets: vitest.fn().mockResolvedValue(undefined),
}));

// why: activity events are written inside the same transaction and are not
// what these tests assert on; stubbing them keeps the transaction body to the
// two writes that matter.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

// why: the cross-org guards issue real Prisma reads. Org-scoping is covered by
// their own tests; here they only need to let a valid create through.
vitest.mock("~/utils/org-validation.server", () => ({
  assertAssetsBelongToOrg: vitest.fn().mockResolvedValue(undefined),
  assertAssetKitsBelongToOrg: vitest.fn().mockResolvedValue(new Map()),
  assertKitsBelongToOrg: vitest.fn().mockResolvedValue(undefined),
  assertTagsBelongToOrg: vitest.fn().mockResolvedValue(undefined),
  assertTeamMemberBelongsToOrg: vitest.fn().mockResolvedValue(undefined),
  assertUserBelongsToOrg: vitest.fn().mockResolvedValue(undefined),
}));

/**
 * The commit-log and transaction-identity hooks this suite's `db` mock hangs
 * off the client. They exist only here, so the real `PrismaClient` type knows
 * nothing about them — naming them structurally keeps the call sites typed
 * instead of casting the client to `any`.
 */
type CreateBookingTestHooks = {
  __committedBookings: () => { id: string }[];
  __lastTx: () => { booking: { create: Mock } } | null;
  __reset: () => void;
};

const testDb = db as unknown as CreateBookingTestHooks;

const hints = { locale: "en-US", timeZone: "UTC" };

/** The minimum a booking needs to be created; tests override per case. */
const baseBooking = {
  name: "Autumn shoot",
  description: null,
  creatorId: "user-1",
  custodianUserId: null,
  custodianTeamMemberId: "tm-1",
  organizationId: "org-1",
  from: new Date("2026-10-01T09:00:00.000Z"),
  to: new Date("2026-10-02T09:00:00.000Z"),
  tags: [],
};

/** The actor `createBooking` hoists out of its transaction once per create. */
const actor = { link: "{actor-link}", snapshot: null };

beforeEach(() => {
  testDb.__reset();
  // why: `clearAllMocks` clears recorded calls but leaves implementations and
  // rejection behaviour in place, so the test that makes a reservation fail
  // would poison every test after it. `mockReset` drops the implementation
  // too; the write core's return value is discarded by `createBooking`, so the
  // reset default of `undefined` is all it needs.
  vitest.mocked(writeBookingModelRequestInTx).mockReset();
  vitest.mocked(loadActorBestEffort).mockReset();
  vitest.mocked(loadActorBestEffort).mockResolvedValue(actor);
});

/** The `(tx, args)` pairs the reservation write core was called with. */
function reservationWrites() {
  return vitest
    .mocked(writeBookingModelRequestInTx)
    .mock.calls.map(([tx, args]) => ({ tx, args }));
}

describe("createBooking model reservations", () => {
  it("writes model reservations inside the booking's own transaction", async () => {
    await createBooking({
      booking: baseBooking,
      assetIds: [],
      hints,
      modelRequests: [
        { assetModelId: "am1", quantity: 2 },
        { assetModelId: "am2", quantity: 5 },
      ],
    });

    const writes = reservationWrites();

    expect(
      writes.map(({ args }) => ({
        assetModelId: args.assetModelId,
        quantity: args.quantity,
      }))
    ).toEqual([
      { assetModelId: "am1", quantity: 2 },
      { assetModelId: "am2", quantity: 5 },
    ]);

    // why: one transaction is the whole point — a booking that commits without
    // its reservations is exactly the half-made state this avoids. The only
    // evidence that survives mocking is client identity, so assert the write
    // core received the very object whose `booking.create` made this booking.
    const tx = testDb.__lastTx();
    expect(tx).not.toBeNull();
    expect(tx?.booking.create).toHaveBeenCalledTimes(1);
    // Identity, not deep equality: two different transaction clients from this
    // mock are structurally identical, so `toEqual` would pass against the
    // exact bug this asserts against.
    for (const { tx: handed } of writes) {
      expect(handed).toBe(tx);
    }

    // The reservations hang off the booking this call created, not some id the
    // caller supplied — which is only possible from inside the transaction.
    const [committed] = testDb.__committedBookings();
    expect(writes.map(({ args }) => args.bookingId)).toEqual([
      committed.id,
      committed.id,
    ]);
    expect(writes.map(({ args }) => args.organizationId)).toEqual([
      "org-1",
      "org-1",
    ]);
    expect(writes.map(({ args }) => args.userId)).toEqual(["user-1", "user-1"]);
  });

  it("creates no booking at all when a reservation fails", async () => {
    // why: a model whose pool cannot cover the ask is the expected failure —
    // the write core throws a 400 rather than writing a short reservation.
    vitest.mocked(writeBookingModelRequestInTx).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Only 3 units are available in this period.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    await expect(
      createBooking({
        booking: baseBooking,
        assetIds: [],
        hints,
        modelRequests: [{ assetModelId: "am1", quantity: 99 }],
      })
    ).rejects.toBeTruthy();

    // The booking row was created inside the transaction before the reservation
    // was attempted; it must not survive the reservation's failure.
    expect(testDb.__committedBookings()).toHaveLength(0);
  });

  it("is unchanged when modelRequests is omitted", async () => {
    // why: every existing caller omits it; this pins that the new branch is
    // inert — no reservation write, and not even the actor lookup the
    // reservation path hoists out of the transaction.
    await createBooking({ booking: baseBooking, assetIds: ["a1"], hints });

    expect(reservationWrites()).toEqual([]);
    expect(vitest.mocked(loadActorBestEffort)).not.toHaveBeenCalled();
    expect(testDb.__committedBookings()).toHaveLength(1);
  });

  it("loads the actor once and reuses it for every reservation", async () => {
    await createBooking({
      booking: baseBooking,
      assetIds: [],
      hints,
      modelRequests: [
        { assetModelId: "am1", quantity: 1 },
        { assetModelId: "am2", quantity: 1 },
        { assetModelId: "am3", quantity: 1 },
      ],
    });

    // why: the actor read is a plain `User` lookup with nothing to serialise
    // against the reservation write. One call per reservation would hold the
    // interactive transaction open across reads that do not belong in it.
    expect(vitest.mocked(loadActorBestEffort)).toHaveBeenCalledTimes(1);
    expect(vitest.mocked(loadActorBestEffort)).toHaveBeenCalledWith("user-1");
    expect(reservationWrites().map(({ args }) => args.actor)).toEqual([
      actor,
      actor,
      actor,
    ]);
  });
});
