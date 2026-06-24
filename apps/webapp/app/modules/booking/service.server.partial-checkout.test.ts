import { BookingStatus, AssetStatus, AssetType } from "@prisma/client";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";

import { db } from "~/database/db.server";
import * as activityEventService from "~/modules/activity-event/service.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import * as quantityLock from "~/modules/consumption-log/quantity-lock.server";
import { ShelfError } from "~/utils/error";
import {
  computeBookingAssetSliceRemainingToCheckOut,
  getRemainingCheckoutAssetIds,
  getRemainingCheckoutPayload,
  partialCheckoutBooking,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Setup timezone for consistent test behavior across environments
const originalTZ = process.env.TZ;

beforeAll(() => {
  // Force tests to run in UTC for consistent behavior across environments
  process.env.TZ = "UTC";
});

afterAll(() => {
  if (originalTZ !== undefined) {
    process.env.TZ = originalTZ;
  } else {
    delete process.env.TZ;
  }
});

// why: exercise the booking service business logic without hitting a real DB.
// The $transaction mock runs the callback synchronously against the same `db`
// mock so the in-transaction `tx` calls resolve through the per-model mocks.
//
// PartialBookingCheckout: state-tracking mock. The service writes a PBC row
// mid-tx and then loops back through `partialBookingCheckout.findMany` (via
// `computeBookingAssetRemainingToCheckOut`) to derive `remainingAssetCount`.
// Without state-tracking, the post-create read returns the default `[]` and
// `remaining = booked - 0 = booked`, so every scanned asset still counts as
// remaining and `remainingAssetCount` is wrong. The closure here mirrors what
// a real in-tx Prisma client would surface: each `.create` push is visible
// to subsequent `.findMany` reads in the same test run; `__resetPbcState()`
// is the per-test escape hatch invoked from `beforeEach`.
vitest.mock("~/database/db.server", () => {
  // eslint-disable-next-line prefer-const -- reassigned by __resetPbcState
  let _pbcSessions: Array<{ assetIds: string[]; quantities: number[] }> = [];
  return {
    db: {
      $transaction: vitest
        .fn()
        .mockImplementation((callbackOrArray: unknown) =>
          typeof callbackOrArray === "function"
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (callbackOrArray as (tx: unknown) => unknown)(db as any)
            : Promise.all(callbackOrArray as Promise<unknown>[])
        ),
      booking: {
        findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
        // why: computeBookingAssetRemainingToCheckOut's legacy-ONGOING
        // fallback (bug #96 follow-up) reads `booking.status` via a cheap
        // findUnique. Default to RESERVED so the fallback short-circuits and
        // tests fall through to the existing aligned/legacy attribution math
        // — tests that deliberately model an ONGOING/OVERDUE booking with
        // pre-existing PBC sessions override this per-test (or seed the
        // session via __seedPbcSessions, which keeps `sessions.length > 0`
        // so the fallback doesn't trip either way).
        findUnique: vitest
          .fn()
          .mockResolvedValue({ status: BookingStatus.RESERVED }),
        update: vitest.fn().mockResolvedValue({}),
      },
      asset: {
        // why: scanned-batch conflict/custody lookup + the in-tx kit-info read both
        // call db.asset.findMany. Default to echoing the requested ids with no
        // conflicts/custody so the happy path passes; individual tests override.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        findMany: vitest.fn().mockImplementation((args?: any) => {
          const ids = args?.where?.id?.in;
          return Promise.resolve(
            Array.isArray(ids)
              ? ids.map((id: string) => ({
                  id,
                  title: `Asset ${id}`,
                  status: AssetStatus.AVAILABLE,
                  // Post-pivot: conflicts come through bookingAssets[].booking,
                  // kit membership through assetKits[].
                  bookingAssets: [],
                  assetKits: [],
                }))
              : []
          );
        }),
        updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
        // why: the qty-path per-asset status flip uses singular `update` (the
        // assetId comes from the validated qtySummaries set, so `updateMany`
        // would be overkill). The mock just needs to resolve.
        update: vitest.fn().mockResolvedValue({}),
      },
      kit: {
        updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      },
      // why: post-pivot the bookingAsset pivot is read by both
      // checkoutBooking's delegate-path enumeration AND
      // `computeBookingAssetRemainingToCheckOut` (which computes booked total
      // from `Σ bookingAsset.quantity for this asset`). For the per-asset
      // INDIVIDUAL legacy path the booked total is implicitly 1, so the
      // default echoes one slice with `quantity: 1`. Qty-tracked tests
      // override per-describe `beforeEach` to model bigger slices.
      bookingAsset: {
        findMany: vitest.fn().mockResolvedValue([{ quantity: 1 }]),
        // why: `computeBookingAssetSliceRemaining` reads a single slice's
        // quantity via `findUnique({ where: { id: bookingAssetId } })`. The
        // default 1-unit slice keeps the legacy INDIVIDUAL slice cap healthy;
        // qty tests override.
        findUnique: vitest.fn().mockResolvedValue({ quantity: 1 }),
        count: vitest.fn().mockResolvedValue(0),
        deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      },
      // why: checkoutBooking's defence-in-depth guard reads
      // `bookingModelRequest` for outstanding model-request rows that would
      // block checkout. Default to none so the delegate path proceeds.
      bookingModelRequest: {
        findMany: vitest.fn().mockResolvedValue([]),
        findUnique: vitest.fn().mockResolvedValue(null),
        update: vitest.fn().mockResolvedValue({}),
      },
      // why: stateful PartialBookingCheckout — see top-of-mock comment. The
      // impls are re-installed by `__installStatefulPbcMocks()` in each
      // beforeEach so a prior test's `mockResolvedValue` / `mockImplementation`
      // override (used to model multi-session reads, e.g. "prior session
      // already claimed 45 units") doesn't permanently replace the stateful
      // closure for later tests.
      partialBookingCheckout: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: vitest.fn().mockImplementation((args: any) => {
          const data = args?.data ?? {};
          _pbcSessions.push({
            assetIds: Array.isArray(data.assetIds) ? data.assetIds : [],
            quantities: Array.isArray(data.quantities) ? data.quantities : [],
          });
          return Promise.resolve({ id: `pbc-${_pbcSessions.length}` });
        }),
        findMany: vitest
          .fn()
          .mockImplementation(() => Promise.resolve(_pbcSessions)),
      },
      // why: `computeBookingAssetSliceRemaining` (called per qty-tracked
      // slice by `partialCheckoutBooking`) runs `tx.consumptionLog.aggregate`
      // to subtract already-logged check-in units from the slice cap.
      // Default to zero so the slice cap = full booked quantity and tests
      // reach their actual assertions rather than the wrapper's generic
      // "Something went wrong while partially checking out booking" error.
      consumptionLog: {
        aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      },
      // Escape hatch for `beforeEach` to clear the in-memory PBC session log
      // between tests so a prior test's writes can't leak into the next one's
      // `remainingAssetCount` calculation.
      __resetPbcState: () => {
        _pbcSessions = [];
      },
      // Pre-populate the stateful PBC log — for tests that want to model
      // "prior session(s) already claimed X units" without overriding
      // `.findMany` (which would replace the stateful impl).
      __seedPbcSessions: (
        sessions: Array<{ assetIds: string[]; quantities: number[] }>
      ) => {
        for (const s of sessions) {
          _pbcSessions.push({
            assetIds: [...s.assetIds],
            quantities: [...s.quantities],
          });
        }
      },
      // Re-install the stateful `partialBookingCheckout.create` / `.findMany`
      // implementations. A prior test may have overridden them via
      // `mockResolvedValue` / `mockImplementation`, which `clearAllMocks` does
      // NOT restore. Call this from `beforeEach` so every test starts with the
      // stateful pair active again.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      __installStatefulPbcMocks: (db_: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db_.partialBookingCheckout.create.mockImplementation((args: any) => {
          const data = args?.data ?? {};
          _pbcSessions.push({
            assetIds: Array.isArray(data.assetIds) ? data.assetIds : [],
            quantities: Array.isArray(data.quantities) ? data.quantities : [],
          });
          return Promise.resolve({ id: `pbc-${_pbcSessions.length}` });
        });
        db_.partialBookingCheckout.findMany.mockImplementation(() =>
          Promise.resolve(_pbcSessions)
        );
      },
    },
  };
});

// why: lockAssetForQuantityUpdate uses $queryRaw (FOR UPDATE), which the
// per-model db mock cannot express. Stub it to return a minimal Asset row
// so the qty-tracked partial-checkout loop can read title/type/unitOfMeasure
// off the locked asset. Tests override per-asset as needed.
vitest.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn().mockResolvedValue({
    id: "asset-qty-default",
    title: "Default Asset",
    type: AssetType.QUANTITY_TRACKED,
    unitOfMeasure: null,
    quantity: 0,
  }),
}));

// why: prevent real user lookups; the service only needs name fields for notes.
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    displayName: "Test User",
  }),
}));

// why: testing the service without writing real asset notes.
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn().mockResolvedValue(undefined),
}));

// why: testing the service without writing real booking notes.
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
  createStatusTransitionNote: vitest.fn().mockResolvedValue({}),
}));

// why: assert on the activity events emitted without persisting them.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

// why: org-validation guard used by the full checkout delegate; pass it.
vitest.mock("~/utils/org-validation.server", () => ({
  assertAssetsBelongToOrg: vitest.fn().mockResolvedValue(undefined),
}));

// why: prevent real email sends from the full-checkout delegate path.
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn(),
}));

// why: prevent real notification-recipient DB lookups during scheduling.
vitest.mock("./notification-recipients.server", () => ({
  getBookingNotificationRecipients: vitest.fn().mockResolvedValue([]),
}));

// why: prevent real job scheduling / queue operations during tests.
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    cancel: vitest.fn(),
    schedule: vitest.fn(),
    sendAfter: vitest.fn(),
  },
  QueueNames: {
    BOOKING_UPDATES: "booking-updates",
    bookingQueue: "booking-queue",
  },
}));

const HOURS = 8;
const futureFrom = new Date();
futureFrom.setDate(futureFrom.getDate() + 30);
const futureTo = new Date(futureFrom.getTime() + HOURS * 60 * 60 * 1000);

const mockHints = {
  timeZone: "America/New_York",
  locale: "en-US",
};

/** RESERVED booking with 3 standalone assets, all still Booked. */
// why (post-pivot): assets now live behind the BookingAsset pivot — each row
// shaped { asset: { ... } }. `_count.bookingAssets` replaces `_count.assets`.
// Kit membership lives on `Asset.assetKits[]` (empty arrays for standalones).
const reservedBooking = {
  id: "booking-1",
  name: "Test Booking",
  status: BookingStatus.RESERVED,
  organizationId: "org-1",
  custodianUserId: "user-1",
  custodianTeamMemberId: null,
  from: futureFrom,
  to: futureTo,
  // why: checkoutBooking (the full-op delegate) reads `_count.bookingAssets`
  // for the reminder email; the email-include re-fetch returns the same shape.
  _count: { bookingAssets: 3 },
  bookingAssets: [
    {
      asset: { id: "asset-1", status: AssetStatus.AVAILABLE, assetKits: [] },
    },
    {
      asset: { id: "asset-2", status: AssetStatus.AVAILABLE, assetKits: [] },
    },
    {
      asset: { id: "asset-3", status: AssetStatus.AVAILABLE, assetKits: [] },
    },
  ],
};

const baseParams = {
  id: "booking-1",
  organizationId: "org-1",
  userId: "user-1",
  hints: mockHints,
};

describe("partialCheckoutBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: clear the in-memory PartialBookingCheckout log between tests so a
    // prior test's `.create` writes can't leak into this test's `remaining`
    // calculations, and re-install the stateful PBC impls (clearAllMocks does
    // NOT restore a prior test's mockResolvedValue / mockImplementation
    // overrides). See the top-of-file mock comment for full rationale.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__resetPbcState?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__installStatefulPbcMocks?.(db);

    // why: clearAllMocks resets call history but not mockResolvedValue overrides
    // set by a prior test. Restore the default "echo requested ids, no conflicts"
    // implementation so each test starts from a clean happy-path baseline.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      (args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids)
            ? ids.map((id: string) => ({
                id,
                title: `Asset ${id}`,
                status: AssetStatus.AVAILABLE,
                // Post-pivot shape (see top-of-file mock for full comment).
                bookingAssets: [],
                assetKits: [],
              }))
            : []
        );
      }
    );
    // why: `computeBookingAssetRemainingToCheckOut` reads the BookingAsset
    // pivot to compute the per-asset booked total. The legacy INDIVIDUAL
    // fixtures don't carry an explicit `quantity` on the asset, so model
    // each as a single 1-unit slice — that's what production writes for
    // INDIVIDUAL pivot rows.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ quantity: 1 }]);
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 1 });
  });

  it("deduplicates submitted assetIds (idempotent count/record)", async () => {
    expect.assertions(1);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // The mobile endpoint's schema doesn't enforce unique ids — a duplicate must
    // not inflate the count or write a duplicate into the record.
    await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1", "asset-1"],
    });

    // why: Wave B writes positionally-aligned quantities[] alongside assetIds[];
    // legacy INDIVIDUAL-only payloads use 1 per id.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-1"],
        quantities: [1],
        checkoutCount: 1,
      },
      select: { id: true },
    });
  });

  it("flips a RESERVED booking to ONGOING and scanned assets to CHECKED_OUT on the first partial scan", async () => {
    expect.assertions(4);

    // First lookup loads the still-RESERVED booking; the post-update re-fetch
    // (which becomes the returned booking) reflects the ONGOING transition.
    const ongoingBooking = {
      ...reservedBooking,
      status: BookingStatus.ONGOING,
    };
    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(reservedBooking)
      .mockResolvedValue(ongoingBooking);

    const result = await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1", "asset-2"],
    });

    // Scanned assets flipped to CHECKED_OUT, org-scoped.
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });

    // First scan transitions the booking RESERVED -> ONGOING.
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: BookingStatus.ONGOING },
      })
    );

    // A partial check-out record is created for the scanned batch.
    // why: Wave B writes positionally-aligned quantities[] alongside assetIds[];
    // legacy INDIVIDUAL-only payloads use 1 per id.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-1", "asset-2"],
        quantities: [1, 1],
        checkoutCount: 2,
      },
      select: { id: true },
    });

    expect(result).toEqual({
      booking: ongoingBooking,
      checkedOutAssetCount: 2,
      remainingAssetCount: 1,
      isComplete: false,
    });
  });

  it("adjusts the booking start date on the first early partial scan when the user opts to adjust", async () => {
    expect.assertions(1);

    // reservedBooking.from is in the future, so this is an early checkout.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1"],
      intentChoice: CheckoutIntentEnum["with-adjusted-date"],
    });

    // The transition moves `from` to now and preserves the original start —
    // mirroring the all-at-once checkout's adjusted-date path.
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingStatus.ONGOING,
          originalFrom: reservedBooking.from,
          from: expect.any(Date),
        }),
      })
    );
  });

  it("records one BOOKING_PARTIAL_CHECKOUT event per scanned asset", async () => {
    expect.assertions(1);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1", "asset-2"],
    });

    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: "BOOKING_PARTIAL_CHECKOUT",
          assetId: "asset-1",
          bookingId: "booking-1",
        }),
        expect.objectContaining({
          action: "BOOKING_PARTIAL_CHECKOUT",
          assetId: "asset-2",
          bookingId: "booking-1",
        }),
      ],
      expect.anything()
    );
  });

  it("names an individual kit asset in the activity-log note when only part of its kit is checked out", async () => {
    expect.assertions(2);

    // Booking holds a 2-asset kit (kit-1). Checking out only ONE of its assets
    // means the kit is NOT a complete-kit line, so the note must still name the
    // individual asset. Regression: this previously rendered an empty
    // "performed a partial check-out: ." because a kit-member asset whose kit
    // wasn't fully checked out fell through both the kit and standalone buckets.
    //
    // Post-pivot shape: booking carries `bookingAssets[]` (pivot rows) instead
    // of `assets[]`, and each pivot row's `asset.assetKits[]` carries the kit
    // membership. See top-of-file mock comment for the full shape rationale.
    const kitBooking = {
      ...reservedBooking,
      _count: { bookingAssets: 2 },
      bookingAssets: [
        {
          asset: {
            id: "asset-k1",
            status: AssetStatus.AVAILABLE,
            assetKits: [{ kit: { id: "kit-1", name: "Camera Kit" } }],
          },
        },
        {
          asset: {
            id: "asset-k2",
            status: AssetStatus.AVAILABLE,
            assetKits: [{ kit: { id: "kit-1", name: "Camera Kit" } }],
          },
        },
      ],
    };
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(kitBooking);

    // why: the in-tx kit-info read must return the scanned asset WITH its kit
    // attached (and AVAILABLE / no conflicts) so the note-builder sees a
    // kit-member asset whose kit isn't fully checked out. Pivot shape: kit
    // membership lives under `asset.assetKits[0].kit`, not `asset.kit`.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      (args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids)
            ? ids.map((id: string) => ({
                id,
                title: `Asset ${id}`,
                status: AssetStatus.AVAILABLE,
                bookingAssets: [],
                assetKits: [{ kit: { id: "kit-1", name: "Camera Kit" } }],
              }))
            : []
        );
      }
    );

    await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-k1"],
    });

    // The individual asset is named (linked) in the note...
    expect(createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("/assets/asset-k1"),
      }),
      expect.anything()
    );
    // ...and the note is never the empty "partial check-out: ." form.
    const contents = (
      createSystemBookingNote as ReturnType<typeof vitest.fn>
    ).mock.calls.map((call) => call[0].content as string);
    expect(contents.every((c) => !/partial check-out:\s*\./.test(c))).toBe(
      true
    );
  });

  it("delegates to the full checkout (isComplete=true) when the batch covers every still-Booked asset", async () => {
    expect.assertions(2);

    // Only one asset on the booking; scanning it covers everything outstanding.
    const singleAssetBooking = {
      ...reservedBooking,
      _count: { bookingAssets: 1 },
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            status: AssetStatus.AVAILABLE,
            assetKits: [],
          },
        },
      ],
    };
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(singleAssetBooking);

    const result = await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1"],
    });

    // The final batch is recorded in the partial-checkout source of truth (so
    // the read helpers see every checked-out asset), then delegates to the full
    // checkout. Wave B added positionally-aligned `quantities[]` to the
    // delegate-path write too — INDIVIDUAL outstanding ids carry implicit
    // qty=1 per slot.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-1"],
        quantities: [1],
        checkoutCount: 1,
      },
    });
    expect(result.isComplete).toBe(true);
  });

  it("does NOT delegate to full checkout once partial-checkout records exist; the later final batch completes in the partial path", async () => {
    expect.assertions(2);

    // ONGOING booking with asset-1 & asset-2 already checked out (recorded).
    // Scanning the last outstanding asset-3 must stay in the partial path — NOT
    // re-run the whole-booking checkoutBooking (which would call db.booking.update).
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ ...reservedBooking, status: BookingStatus.ONGOING });
    // Seed prior session via the stateful helper so the new asset-3 write
    // appends to the same log — the post-write `remainingAssetCount` loop
    // must see ALL three assets as checked out to report isComplete=true.
    // (mockResolvedValue would freeze findMany at the prior session.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-1", "asset-2"], quantities: [1, 1] },
    ]);

    const result = await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-3"],
    });

    // No delegation and no first-scan transition → booking.update is untouched.
    expect(db.booking.update).not.toHaveBeenCalled();
    // All booking assets are now checked out → the partial path reports complete.
    expect(result.isComplete).toBe(true);
  });

  it("throws when a scanned asset is in custody", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // The scanned-batch lookup reports asset-1 in custody. Post-pivot, the
    // findMany include returns `bookingAssets` (not `bookings`) for conflict
    // detection; an empty array means no conflicts on these assets.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Camera",
        status: AssetStatus.IN_CUSTODY,
        bookingAssets: [],
        assetKits: [],
      },
      {
        id: "asset-2",
        title: "Tripod",
        status: AssetStatus.AVAILABLE,
        bookingAssets: [],
        assetKits: [],
      },
    ]);

    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1", "asset-2"],
      })
    ).rejects.toThrow(ShelfError);

    // No partial record written when validation rejects.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("throws when a scanned asset is booked/checked-out elsewhere (overlapping conflict)", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // why: the scanned-batch conflict lookup returns asset-1 with a conflicting
    // overlapping booking (a different RESERVED booking), which makes
    // hasAssetBookingConflicts() return true. Post-pivot, conflicting bookings
    // are projected through `asset.bookingAssets[].booking`, not the removed
    // implicit `asset.bookings[]`. This guard is unique to partial check-OUT
    // (check-in has no conflict validation), so it needs its own coverage.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Camera",
        status: AssetStatus.AVAILABLE,
        bookingAssets: [
          {
            booking: { id: "other-booking", status: BookingStatus.RESERVED },
          },
        ],
        assetKits: [],
      },
      {
        id: "asset-2",
        title: "Tripod",
        status: AssetStatus.AVAILABLE,
        bookingAssets: [],
        assetKits: [],
      },
    ]);

    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1", "asset-2"],
      })
    ).rejects.toThrow(ShelfError);

    // No partial record written when conflict validation rejects.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("rejects (and writes nothing) when a scanned asset is not part of the booking", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // The outer try/catch re-wraps the inner 400 ShelfError, preserving its
    // user-facing message (mirrors partial check-in error handling).
    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1", "asset-unrelated"],
      })
    ).rejects.toThrow("Some assets are not part of this booking");

    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("rejects (and writes nothing) when the booking status is not eligible for checkout", async () => {
    expect.assertions(2);

    // A COMPLETE booking must not be mutable via a direct service call (the web
    // action + mobile endpoint both call this directly).
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      ...reservedBooking,
      status: BookingStatus.COMPLETE,
    });

    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1"],
      })
    ).rejects.toThrow("can't be checked out in its current status");

    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("rejects and writes no duplicate record when re-scanning an already-checked-out INDIVIDUAL asset", async () => {
    expect.assertions(2);

    // why: this covers ONLY the INDIVIDUAL case — "fully out" is a per-asset
    // boolean (status === CHECKED_OUT or recorded in a PBC session). The
    // QUANTITY_TRACKED equivalent ("remaining === 0 via partial sessions") is
    // covered by a dedicated test in the qty-tracked describe block — see
    // "rejects re-scan of a QUANTITY_TRACKED asset when remaining === 0".
    // A QT asset with units still left to claim must be acceptable for top-off.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // asset-1 (INDIVIDUAL, implicit quantity = 1) was already checked out for
    // this booking in a prior session.
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetIds: ["asset-1"] }]);

    // Re-scan only asset-1 (already recorded) → nothing left to check out, so
    // the idempotency guard rejects before creating any new record.
    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1"],
      })
    ).rejects.toThrow("already checked out for this booking");

    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });
});

describe("partialCheckoutBooking - quantity-tracked dispositions", () => {
  /**
   * Wave B extension: partial check-out accepts a `checkouts[]` array of
   * per-slice `{ assetId, quantity }` dispositions in addition to the legacy
   * `assetIds[]` (implicit qty=1 for INDIVIDUAL). Mirrors the partial-CHECKIN
   * matrix in `service.server.test.ts` but on the outbound side.
   */

  /**
   * Booking with a single QUANTITY_TRACKED asset booked for 50 units total
   * (1 pivot row, qty=50). The pivot id is referenced by `bookingAssetId` on
   * the disposition input.
   */
  const qtyOnlyBooking = {
    id: "booking-1",
    name: "Test Booking",
    status: BookingStatus.RESERVED,
    organizationId: "org-1",
    custodianUserId: "user-1",
    custodianTeamMemberId: null,
    from: futureFrom,
    to: futureTo,
    _count: { bookingAssets: 1 },
    bookingAssets: [
      {
        id: "ba-qty-1",
        quantity: 50,
        asset: {
          id: "asset-qty-1",
          status: AssetStatus.AVAILABLE,
          type: AssetType.QUANTITY_TRACKED,
          title: "Pens",
          unitOfMeasure: null,
          assetKits: [],
        },
      },
    ],
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    // why: clear the in-memory PartialBookingCheckout log between tests so a
    // prior test's `.create` writes can't leak into this test's `remaining`
    // calculations, and re-install the stateful PBC impls (clearAllMocks does
    // NOT restore a prior test's mockResolvedValue / mockImplementation
    // overrides). See the top-of-file mock comment for full rationale.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__resetPbcState?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__installStatefulPbcMocks?.(db);

    // Default echo-no-conflicts for the scanned-batch lookup; tests that
    // need conflicts/custody override per-call.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      (args?: { where?: { id?: { in?: string[] } } }) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids)
            ? ids.map((id: string) => ({
                id,
                title: `Asset ${id}`,
                status: AssetStatus.AVAILABLE,
                bookingAssets: [],
                assetKits: [],
              }))
            : []
        );
      }
    );
    // why: lockAssetForQuantityUpdate is called inside the qty loop; default to
    // the qty-only asset so its title flows into the "Only N units left" error.
    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-qty-1",
      title: "Pens",
      type: AssetType.QUANTITY_TRACKED,
      unitOfMeasure: null,
      quantity: 50,
    });
    // why: computeBookingAssetRemainingToCheckOut reads tx.bookingAsset.findMany
    // for the pivot rows (`booked = Σ quantity`). Default to a single qty=50
    // pivot so `remaining = 50 - claimedSoFar`. Tests override per-need.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ quantity: 50 }]);
    // why: computeBookingAssetSliceRemaining reads tx.bookingAsset.findUnique
    // for the per-slice cap. Default to the same qty=50 slice so the per-slice
    // cap = full booked quantity for qty-only fixtures; tests override when
    // they model a different slice (kit + standalone, multiple slices, etc.).
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 50 });
  });

  it("partial qty (5 of 50) flips no status, records quantities[0]=5", async () => {
    expect.assertions(3);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(qtyOnlyBooking);

    const result = await partialCheckoutBooking({
      ...baseParams,
      checkouts: [
        { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 5 },
      ],
    });

    // Asset stays AVAILABLE — partial claim leaves units in the pool. The
    // qty-flip updateMany only runs when remainingAfter === 0, and the
    // INDIVIDUAL updateMany doesn't run because there are no individuals.
    expect(db.asset.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: AssetStatus.CHECKED_OUT },
      })
    );

    // PartialBookingCheckout row records the exact slice: aligned arrays.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-qty-1"],
        quantities: [5],
        checkoutCount: 1,
      },
      select: { id: true },
    });

    // 45 units still booked → batch is not complete.
    expect(result.isComplete).toBe(false);
  });

  it("full qty (50 of 50) flips Asset.status to CHECKED_OUT and records quantities[0]=50", async () => {
    expect.assertions(2);

    // Single-asset booking covered fully → delegation to full checkoutBooking
    // would normally fire, but only when `qtyClaimsCoverFullRemaining` is true
    // AND we're RESERVED with no prior records. The delegation path itself is
    // covered by the existing INDIVIDUAL "delegates to full checkout" test;
    // here we keep it in the partial path by using an ONGOING booking so the
    // qty-only flow remains observable end-to-end.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ ...qtyOnlyBooking, status: BookingStatus.ONGOING });

    await partialCheckoutBooking({
      ...baseParams,
      checkouts: [
        { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 50 },
      ],
    });

    // Full-remaining claim → status flips to CHECKED_OUT (org-scoped).
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-qty-1"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });

    // Session row records the full 50 units against the same assetId.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-qty-1"],
        quantities: [50],
        checkoutCount: 1,
      },
      select: { id: true },
    });
  });

  it("multi-asset mixed (INDIVIDUAL + qty) routes each through its own path", async () => {
    expect.assertions(4);

    // ONGOING so a final batch over both assets doesn't trip the
    // delegate-to-full-checkout path; we want to observe both branches inline.
    const mixedBooking = {
      ...qtyOnlyBooking,
      status: BookingStatus.ONGOING,
      _count: { bookingAssets: 2 },
      bookingAssets: [
        {
          id: "ba-qty-1",
          quantity: 50,
          asset: {
            id: "asset-qty-1",
            status: AssetStatus.AVAILABLE,
            type: AssetType.QUANTITY_TRACKED,
            title: "Pens",
            unitOfMeasure: null,
            assetKits: [],
          },
        },
        {
          id: "ba-ind-1",
          quantity: 1,
          asset: {
            id: "asset-ind-1",
            status: AssetStatus.AVAILABLE,
            type: AssetType.INDIVIDUAL,
            title: "Tripod",
            unitOfMeasure: null,
            assetKits: [],
          },
        },
      ],
    };
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(mixedBooking);

    await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-ind-1"],
      checkouts: [
        { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 10 },
      ],
    });

    // INDIVIDUAL row goes through the assetIds → individualToFlip updateMany
    // (always flips on a partial-checkout batch).
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-ind-1"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });

    // QTY row did NOT flip (10 of 50 = partial claim).
    expect(db.asset.updateMany).not.toHaveBeenCalledWith({
      where: { id: { in: ["asset-qty-1"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });

    // Session row records both rows positionally: qty disposition first
    // (iteration order matches `dispositions[]`: checkouts before assetIds
    // fallback), INDIVIDUAL gets implicit 1.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-qty-1", "asset-ind-1"],
        quantities: [10, 1],
        checkoutCount: 2,
      },
      select: { id: true },
    });

    // One BOOKING_PARTIAL_CHECKOUT event per disposition.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: "BOOKING_PARTIAL_CHECKOUT",
          assetId: "asset-qty-1",
          bookingId: "booking-1",
        }),
        expect.objectContaining({
          action: "BOOKING_PARTIAL_CHECKOUT",
          assetId: "asset-ind-1",
          bookingId: "booking-1",
        }),
      ],
      expect.anything()
    );
  });

  it("rejects (with helpful message) when claimed qty exceeds remainingToCheckOut", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ ...qtyOnlyBooking, status: BookingStatus.ONGOING });

    // Pretend a prior session already claimed 45 units → remaining = 5.
    // Use the stateful seed helper rather than `mockResolvedValue` on
    // `partialBookingCheckout.findMany` so the test infra still tracks the
    // current-batch writes for downstream reads (and so this override doesn't
    // leak into later tests via the persistent impl).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-qty-1"], quantities: [45] },
    ]);

    await expect(
      partialCheckoutBooking({
        ...baseParams,
        checkouts: [
          { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 10 },
        ],
      })
    ).rejects.toThrow(/Only 5 units left to check out for "Pens"/);

    // Tx rolled back: no session row written.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("concurrent guard: row-lock serialises overlapping claims so the second sees post-first remaining", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ ...qtyOnlyBooking, status: BookingStatus.ONGOING });

    // Model the row-lock with a serialisation gate on
    // `lockAssetForQuantityUpdate`: the first caller "holds" the lock until
    // its `PartialBookingCheckout.create` commits; the second caller's lock
    // call awaits that signal. With the stateful PBC mock, the second
    // caller's in-tx `computeBookingAssetRemainingToCheckOut` then sees the
    // first caller's just-committed session and computes remaining = 20.
    // 30 + 30 > 50 → claim 2 rejects with "Only 20 units left".
    let lockCount = 0;
    let releaseFirstLock: (() => void) | null = null;
    const firstLockReleased = new Promise<void>((resolve) => {
      releaseFirstLock = resolve;
    });
    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockImplementation(async () => {
      lockCount += 1;
      if (lockCount > 1) {
        await firstLockReleased;
      }
      return {
        id: "asset-qty-1",
        title: "Pens",
        type: AssetType.QUANTITY_TRACKED,
        unitOfMeasure: null,
        quantity: 50,
      };
    });
    // Wrap PBC.create to release the lock once the first caller commits.
    const originalCreate = (
      db.partialBookingCheckout.create as ReturnType<typeof vitest.fn>
    ).getMockImplementation();
    (
      db.partialBookingCheckout.create as ReturnType<typeof vitest.fn>
    ).mockImplementation(async (args: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (originalCreate as any)(args);
      if (releaseFirstLock) {
        releaseFirstLock();
        releaseFirstLock = null;
      }
      return result;
    });

    const claim = () =>
      partialCheckoutBooking({
        ...baseParams,
        checkouts: [
          { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 30 },
        ],
      });

    const [first, second] = await Promise.allSettled([claim(), claim()]);

    expect(first.status).toBe("fulfilled");
    // Second caller saw only 20 units remaining and rejected — the lock
    // prevented an over-commit (30 + 30 > 50).
    expect(second.status === "rejected" && second.reason.message).toMatch(
      /Only 20 units left/
    );
  });

  it("idempotent re-submit: the recorded quantities array does not double up", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ ...qtyOnlyBooking, status: BookingStatus.ONGOING });

    // First batch already claimed all 50 units → asset is fully checked out
    // for this booking. Re-submitting the same 50-unit disposition must
    // reject before writing a new row, otherwise the same units would be
    // claimed twice and `quantities[]` would record 50 twice.
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetIds: ["asset-qty-1"], quantities: [50] }]);

    await expect(
      partialCheckoutBooking({
        ...baseParams,
        checkouts: [
          { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 50 },
        ],
      })
    ).rejects.toThrow(/Only 0 units left/);

    // No new row → no double-claim, `quantities` array unchanged.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("accepts a top-off re-scan of a QUANTITY_TRACKED asset with remaining > 0", async () => {
    expect.assertions(3);

    // QT asset booked for 50 units, a prior session already claimed 5 → the
    // asset shows up in the recorded `alreadyCheckedOutSet` (via PBC), but
    // remaining = 50 − 5 = 45 > 0 so a top-off claim must be accepted. The
    // INDIVIDUAL rejection path ("already checked out for this booking") must
    // NOT fire for QT here — `assetIdsToCheckOut` keeps QT assets even when
    // they appear in `alreadyCheckedOutSet`, because their per-asset cap is
    // re-checked inside the tx against the freshly-read remaining.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ ...qtyOnlyBooking, status: BookingStatus.ONGOING });

    // Seed via the stateful helper so the new top-off write appends to the
    // session log (mockResolvedValue would freeze findMany and the post-write
    // remaining lookup would miss the new row).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-qty-1"], quantities: [5] },
    ]);

    const result = await partialCheckoutBooking({
      ...baseParams,
      checkouts: [
        { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 10 },
      ],
    });

    // A new top-off PBC row was written with the exact claimed quantity.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-qty-1"],
        quantities: [10],
        checkoutCount: 1,
      },
      select: { id: true },
    });

    // Status stays AVAILABLE: 5 + 10 = 15 out of 50 units → still partial,
    // pool is still partly available so no qty-flip updateMany fires.
    expect(db.asset.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: AssetStatus.CHECKED_OUT },
      })
    );

    // 35 units still booked → batch is not complete.
    expect(result.isComplete).toBe(false);
  });

  it("rejects re-scan of a QUANTITY_TRACKED asset when remaining === 0 via partial sessions", async () => {
    expect.assertions(2);

    // QT-only booking shrunk to 10 booked units so prior sessions consuming 10
    // exhausts the pool entirely. With remaining === 0 a re-scan must reject
    // exactly like the INDIVIDUAL case does when status === CHECKED_OUT — the
    // user shouldn't get a different message for the same "fully out" state.
    const smallQtyBooking = {
      ...qtyOnlyBooking,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          id: "ba-qty-1",
          quantity: 10,
          asset: {
            id: "asset-qty-1",
            // Prior sessions consumed all 10 → status flipped CHECKED_OUT, so
            // the asset is in `alreadyCheckedOutSet` via BOTH the PBC record
            // AND the live status check.
            status: AssetStatus.CHECKED_OUT,
            type: AssetType.QUANTITY_TRACKED,
            title: "Pens",
            unitOfMeasure: null,
            assetKits: [],
          },
        },
      ],
    };
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(smallQtyBooking);
    // Match the smaller booked total inside the qty loop.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ quantity: 10 }]);
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 10 });

    // Seed the prior 10-unit consumption through the stateful helper so the
    // in-tx remaining lookup sees the same row as the outer alreadyCheckedOut
    // detection.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-qty-1"], quantities: [10] },
    ]);

    // The QT cap path renders the "Only N units left" message — that's the
    // same rejection class as the INDIVIDUAL "already checked out" guard:
    // remaining === 0 in both shapes. The two paths differ only in wording.
    await expect(
      partialCheckoutBooking({
        ...baseParams,
        checkouts: [
          { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 1 },
        ],
      })
    ).rejects.toThrow(/Only 0 units left/);

    // No new row written for the rejected re-scan.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("event meta carries quantity for qty-tracked rows and omits it for INDIVIDUAL", async () => {
    expect.assertions(2);

    const mixedBooking = {
      ...qtyOnlyBooking,
      status: BookingStatus.ONGOING,
      _count: { bookingAssets: 2 },
      bookingAssets: [
        {
          id: "ba-qty-1",
          quantity: 50,
          asset: {
            id: "asset-qty-1",
            status: AssetStatus.AVAILABLE,
            type: AssetType.QUANTITY_TRACKED,
            title: "Pens",
            unitOfMeasure: null,
            assetKits: [],
          },
        },
        {
          id: "ba-ind-1",
          quantity: 1,
          asset: {
            id: "asset-ind-1",
            status: AssetStatus.AVAILABLE,
            type: AssetType.INDIVIDUAL,
            title: "Tripod",
            unitOfMeasure: null,
            assetKits: [],
          },
        },
      ],
    };
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(mixedBooking);

    await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-ind-1"],
      checkouts: [
        { assetId: "asset-qty-1", bookingAssetId: "ba-qty-1", quantity: 7 },
      ],
    });

    const recordedEvents = (
      activityEventService.recordEvents as ReturnType<typeof vitest.fn>
    ).mock.calls[0]?.[0] as Array<{
      assetId: string;
      meta: Record<string, unknown>;
    }>;

    const qtyEvent = recordedEvents.find((e) => e.assetId === "asset-qty-1");
    const individualEvent = recordedEvents.find(
      (e) => e.assetId === "asset-ind-1"
    );

    // QTY row: `assetQtyMeta` returns { quantity: 7 } → meta carries it
    // alongside the session id.
    expect(qtyEvent?.meta).toEqual(
      expect.objectContaining({
        quantity: 7,
        partialCheckoutSessionId: expect.anything(),
      })
    );

    // INDIVIDUAL row: `assetQtyMeta` returns {} → meta has no `quantity` key,
    // only the session id.
    expect(individualEvent?.meta).not.toHaveProperty("quantity");
  });
});

describe("getRemainingCheckoutAssetIds", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns only AVAILABLE assets that have not been returned", async () => {
    expect.assertions(1);

    // Mixed booking: one Booked (AVAILABLE), one already CHECKED_OUT, one
    // IN_CUSTODY. Only the AVAILABLE one is still eligible to check out.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      bookingAssets: [
        { asset: { id: "asset-1", status: AssetStatus.AVAILABLE } },
        { asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT } },
        { asset: { id: "asset-3", status: AssetStatus.IN_CUSTODY } },
      ],
      partialCheckins: [],
    });

    const ids = await getRemainingCheckoutAssetIds({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(ids).toEqual(["asset-1"]);
  });

  it("excludes assets returned via partial check-in even though they are AVAILABLE", async () => {
    expect.assertions(1);

    // asset-2 was checked out then checked back in: it is AVAILABLE again but is
    // recorded in partialCheckins, so it must NOT be offered for re-checkout.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      bookingAssets: [
        { asset: { id: "asset-1", status: AssetStatus.AVAILABLE } },
        { asset: { id: "asset-2", status: AssetStatus.AVAILABLE } },
      ],
      partialCheckins: [{ assetIds: ["asset-2"] }],
    });

    const ids = await getRemainingCheckoutAssetIds({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(ids).toEqual(["asset-1"]);
  });

  it("returns an empty array when nothing is eligible", async () => {
    expect.assertions(1);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      bookingAssets: [
        { asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT } },
        { asset: { id: "asset-2", status: AssetStatus.IN_CUSTODY } },
      ],
      partialCheckins: [],
    });

    const ids = await getRemainingCheckoutAssetIds({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(ids).toEqual([]);
  });

  it("org-scopes the booking lookup", async () => {
    expect.assertions(1);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ bookingAssets: [], partialCheckins: [] });

    await getRemainingCheckoutAssetIds({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(db.booking.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1", organizationId: "org-1" },
      })
    );
  });
});

describe("computeBookingAssetSliceRemainingToCheckOut", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__resetPbcState?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__installStatefulPbcMocks?.(db);
  });

  it("subtracts prior PartialBookingCheckout claims from the slice cap on a single-slice asset", async () => {
    expect.assertions(1);

    // Single-slice QT asset booked for 50 units; prior session checked out 5.
    // The slice itself has never been checked IN — the previous helper choice
    // (`computeBookingAssetSliceRemaining`, IN-side) would have returned 50
    // here and then `partialCheckoutBooking` would have rejected the batch.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "ba-qty-1",
      assetId: "asset-qty-1",
      quantity: 50,
      assetKitId: null,
    });
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "ba-qty-1", quantity: 50, assetKitId: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-qty-1"], quantities: [5] },
    ]);

    const remaining = await computeBookingAssetSliceRemainingToCheckOut(
      db,
      "booking-1",
      "ba-qty-1"
    );

    expect(remaining).toBe(45);
  });

  it("returns the full slice cap when no prior claims exist", async () => {
    expect.assertions(1);

    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "ba-qty-1",
      assetId: "asset-qty-1",
      quantity: 50,
      assetKitId: null,
    });
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "ba-qty-1", quantity: 50, assetKitId: null }]);

    const remaining = await computeBookingAssetSliceRemainingToCheckOut(
      db,
      "booking-1",
      "ba-qty-1"
    );

    expect(remaining).toBe(50);
  });

  it("attributes the asset's claim pool to the kit-driven slice first (greedy fill mirrors loader)", async () => {
    expect.assertions(2);

    // Same QT asset booked twice: once as part of a kit (40 units) and once
    // standalone (10 units), total 50. Prior session claimed 30 units of the
    // asset — the greedy fill rule (kit-driven first, then standalone) means
    // the kit slice has 10 remaining and the standalone slice still has 10.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { id: "ba-kit", quantity: 40, assetKitId: "kit-1" },
      { id: "ba-standalone", quantity: 10, assetKitId: null },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-qty-1"], quantities: [30] },
    ]);

    // Probe the kit-driven slice: it should be filled first.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce({
      id: "ba-kit",
      assetId: "asset-qty-1",
      quantity: 40,
      assetKitId: "kit-1",
    });
    const kitSliceRemaining = await computeBookingAssetSliceRemainingToCheckOut(
      db,
      "booking-1",
      "ba-kit"
    );
    expect(kitSliceRemaining).toBe(10);

    // Probe the standalone slice: untouched by the 30-unit claim because the
    // kit slice (40-unit capacity) absorbs it all.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce({
      id: "ba-standalone",
      assetId: "asset-qty-1",
      quantity: 10,
      assetKitId: null,
    });
    const standaloneSliceRemaining =
      await computeBookingAssetSliceRemainingToCheckOut(
        db,
        "booking-1",
        "ba-standalone"
      );
    expect(standaloneSliceRemaining).toBe(10);
  });

  it("returns 0 when the slice is missing (defensive)", async () => {
    expect.assertions(1);

    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(null);

    const remaining = await computeBookingAssetSliceRemainingToCheckOut(
      db,
      "booking-1",
      "ba-missing"
    );

    expect(remaining).toBe(0);
  });
});

describe("getRemainingCheckoutPayload", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__resetPbcState?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__installStatefulPbcMocks?.(db);
  });

  it("emits per-slice remaining (NOT full booked qty) for a partially-checked-out QT asset", async () => {
    expect.assertions(2);

    // Repro for the "Check out remaining" regression on partially-checked-out
    // QT assets: Pencils booked for 50, a prior PartialBookingCheckout already
    // claimed 5 units. The previous helper choice
    // (`computeBookingAssetSliceRemaining`, IN-side) returned the full 50 here
    // (the slice had never been checked in), so the action pushed
    // `{ quantity: 50 }` into the batch and `partialCheckoutBooking` then
    // rejected the claim with "Only 45 units left to check out for Pencils".
    // With the OUT-side per-slice helper this should emit 45 directly.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      bookingAssets: [
        {
          id: "ba-qty-1",
          asset: {
            id: "asset-pencils",
            status: AssetStatus.AVAILABLE,
            type: AssetType.QUANTITY_TRACKED,
          },
        },
      ],
      partialCheckins: [],
    });
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "ba-qty-1",
      assetId: "asset-pencils",
      quantity: 50,
      assetKitId: null,
    });
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "ba-qty-1", quantity: 50, assetKitId: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-pencils"], quantities: [5] },
    ]);

    const payload = await getRemainingCheckoutPayload({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(payload.assetIds).toEqual([]);
    // The check-OUT remaining is 45 (slice 50 − prior claim 5), NOT 50.
    expect(payload.checkouts).toEqual([
      { assetId: "asset-pencils", bookingAssetId: "ba-qty-1", quantity: 45 },
    ]);
  });

  it("the emitted per-slice payload survives partialCheckoutBooking's own cap (no 'Only N left' throw)", async () => {
    expect.assertions(2);

    // End-to-end shape: feed the payload getRemainingCheckoutPayload computes
    // straight into partialCheckoutBooking and assert it commits. This is the
    // exact wire the booking-header action follows (sans the response wrapper);
    // before the fix, partialCheckoutBooking threw because the emitted
    // quantity (50) exceeded the per-asset remaining (45).
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      bookingAssets: [
        {
          id: "ba-qty-1",
          asset: {
            id: "asset-pencils",
            status: AssetStatus.AVAILABLE,
            type: AssetType.QUANTITY_TRACKED,
          },
        },
      ],
      partialCheckins: [],
    });
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "ba-qty-1",
      assetId: "asset-pencils",
      quantity: 50,
      assetKitId: null,
    });
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "ba-qty-1", quantity: 50, assetKitId: null }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).__seedPbcSessions?.([
      { assetIds: ["asset-pencils"], quantities: [5] },
    ]);

    // Resolve the payload the booking-header action would dispatch.
    const { assetIds, checkouts } = await getRemainingCheckoutPayload({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    // Re-prime the booking lookup for partialCheckoutBooking (different
    // select shape — it reads quantity / type / unitOfMeasure off the slice).
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
      organizationId: "org-1",
      custodianUserId: "user-1",
      custodianTeamMemberId: null,
      from: futureFrom,
      to: futureTo,
      _count: { bookingAssets: 1 },
      bookingAssets: [
        {
          id: "ba-qty-1",
          quantity: 50,
          asset: {
            id: "asset-pencils",
            status: AssetStatus.AVAILABLE,
            type: AssetType.QUANTITY_TRACKED,
            title: "Pencils",
            unitOfMeasure: null,
            assetKits: [],
          },
        },
      ],
    });
    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-pencils",
      title: "Pencils",
      type: AssetType.QUANTITY_TRACKED,
      unitOfMeasure: null,
      quantity: 50,
    });
    // partialCheckoutBooking reads tx.bookingAsset.findMany for per-asset
    // totals (booked = Σ quantity). Single 50-unit slice.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ quantity: 50 }]);

    // Should NOT throw — the per-slice payload (45) sits inside the per-asset
    // remaining (50 − 5 = 45) cap, so the second-pass guard accepts it.
    await partialCheckoutBooking({
      ...baseParams,
      assetIds,
      checkouts,
    });

    // Session row records the top-off 45 units against the same assetId,
    // proving the partially-checked-out QT slice was successfully drained.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-pencils"],
        quantities: [45],
        checkoutCount: 1,
      },
      select: { id: true },
    });

    // And we never tripped the "Only N units left" guard mid-flight.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_PARTIAL_CHECKOUT",
          assetId: "asset-pencils",
        }),
      ]),
      expect.anything()
    );
  });
});
