/**
 * Unit tests for the booking-model-request service (Phase 3d).
 *
 * Shape of the mocks mirrors the existing booking/consumption-log
 * test files — inline `db` mock with `$transaction` routing the
 * callback through the same mock, plus per-method `mockResolvedValue`
 * overrides per test.
 *
 * Contract-level assertions only — no assertions on exact error
 * message strings beyond operator-clarity substrings, no
 * `toHaveBeenCalledTimes(N)` without an invariant reason.
 */
import Markdoc from "@markdoc/markdoc";
import { AssetType, BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { ShelfError } from "~/utils/error";
import {
  fulfilModelRequestsForAssets,
  getAssetModelAvailability,
  getBookingModelTabData,
  materializeModelRequestForAsset,
  removeBookingModelRequest,
  upsertBookingModelRequest,
} from "./service.server";

vitest.mock("~/database/db.server", () => ({
  db: {
    // why: the service calls the callback form of $transaction; route it
    // through the same mocked `db` so per-test overrides are visible
    // inside the tx callback.
    // why: the unit claim is a single conditional
    // `UPDATE ... WHERE fulfilledQuantity < quantity ... RETURNING`, so the
    // capacity check, the increment and the completion stamp are one atomic
    // statement. Tests drive it by queueing the RETURNING rows: a row means
    // "this transaction claimed a unit", an empty array means another
    // transaction took the last one.
    $queryRaw: vitest.fn(),
    $transaction: vitest
      .fn()
      .mockImplementation((callbackOrArray) =>
        typeof callbackOrArray === "function"
          ? callbackOrArray(db)
          : Promise.all(callbackOrArray)
      ),
    asset: {
      count: vitest.fn().mockResolvedValue(0),
    },
    assetModel: {
      findUnique: vitest
        .fn()
        .mockResolvedValue({ id: "model-1", name: "Dell Latitude 5550" }),
      count: vitest.fn().mockResolvedValue(0),
      findMany: vitest.fn().mockResolvedValue([]),
    },
    booking: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    bookingAsset: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    bookingModelRequest: {
      // why: `fulfilModelRequestsForAssets` short-circuits on a count of the
      // booking's outstanding reservations before doing any per-asset work
      // (it avoids one round-trip per asset inside the caller's transaction).
      // Default to 1 so the existing suites exercise the loop.
      count: vitest.fn().mockResolvedValue(1),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      upsert: vitest.fn().mockResolvedValue({
        // Equal timestamps = the CREATE branch ran (Prisma stamps both
        // identically on create). Update-path tests override `updatedAt`
        // to signal the UPDATE branch (see the service's `wasCreated`).
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        id: "req-1",
        bookingId: "booking-1",
        assetModelId: "model-1",
        quantity: 3,
      }),
      findUnique: vitest.fn().mockResolvedValue(null),
      delete: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
    },
    bookingNote: {
      create: vitest.fn().mockResolvedValue({}),
    },
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    // why: `recordEvent` writes through the same client it is handed, so the
    // in-tx event writes land here (the `$transaction` mock routes `tx` back
    // to this object).
    activityEvent: {
      create: vitest.fn().mockResolvedValue({}),
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // why: `recordEvent` falls back to its own actor lookup when the caller
    // does not supply `actorSnapshot`. The service always supplies one, so
    // this mock exists to make that invariant assertable — a call here means
    // a redundant user read crept back into a transaction.
    user: {
      findUnique: vitest.fn().mockResolvedValue({
        firstName: "Test",
        lastName: "User",
        displayName: null,
      }),
    },
  },
}));

// why: activity-note actor load pulls user metadata; stub to return the
// minimal fields the markdoc wrapper expects.
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Test",
    lastName: "User",
  }),
}));

// why: system-booking-note write isn't the focus of these tests — stub
// so tests don't care whether it succeeds. The in-tx write inside
// `materializeModelRequestForAsset` goes through the mocked
// `tx.bookingNote.create` above.
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
}));

/**
 * Simulates the conditional claim statement:
 *
 *   UPDATE ... SET fulfilledQuantity = fulfilledQuantity + 1,
 *                  fulfilledAt = CASE WHEN +1 >= quantity THEN NOW() ...
 *   WHERE id = $1 AND fulfilledQuantity < quantity
 *   RETURNING fulfilledQuantity, quantity
 *
 * why: the claim is raw SQL, so a plain `mockResolvedValue` would let a test
 * pass while the statement's actual capacity semantics regressed. Reading the
 * row the test already staged on `findUnique` keeps the mock honest: it
 * refuses when full, returns the POST-write count when it claims, and mutates
 * the staged row so a loop's next read sees the committed value.
 */
function installClaimSimulator() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.$queryRaw as any).mockImplementation(
    async (strings: TemplateStringsArray) => {
      // why: two different raw statements reach this one stub — the pool lock
      // and the unit claim. Answering both from a single queue lets the lock
      // consume a row meant for the claim, so the stub routes on the statement
      // it was handed: the lock is the one naming "AssetModel", and it expects
      // a row back (an empty result means "not in this workspace").
      if (Array.isArray(strings) && strings.join("").includes('"AssetModel"')) {
        return [{ id: MODEL_ID }];
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (db.bookingModelRequest.findUnique as any)();
      if (!row) return [];
      if (row.fulfilledQuantity >= row.quantity) return [];
      row.fulfilledQuantity += 1;
      if (row.fulfilledQuantity >= row.quantity) row.fulfilledAt = new Date();
      return [
        {
          fulfilledQuantity: row.fulfilledQuantity,
          quantity: row.quantity,
          // Mirrors the statement's RETURNING: the completion stamp is
          // computed by the database, and the event reports that value rather
          // than a second one minted in JS.
          fulfilledAt: row.fulfilledAt ?? null,
        },
      ];
    }
  );
}

const BOOKING_ID = "booking-1";
const ORG_ID = "org-1";
const USER_ID = "user-1";
const MODEL_ID = "model-1";

/** Shape of an `ActivityEvent` row as `recordEvent` writes it. */
type RecordedEvent = {
  action: string;
  entityType: string;
  entityId: string;
  bookingId: string | null;
  assetId: string | null;
  actorUserId: string | null;
  field: string | null;
  fromValue?: unknown;
  toValue?: unknown;
  meta?: Record<string, unknown>;
};

/** Every activity event written during the current test, in write order. */
function recordedEvents(): RecordedEvent[] {
  return (
    db.activityEvent.create as unknown as {
      mock: { calls: Array<[{ data: RecordedEvent }]> };
    }
  ).mock.calls.map((call) => call[0].data);
}

/** The activity events written for one action, in write order. */
function eventsOfAction(action: string): RecordedEvent[] {
  return recordedEvents().filter((event) => event.action === action);
}

/**
 * Markdoc tag nodes in a note, parsed exactly as the note feed parses it.
 *
 * Note content legitimately contains `{% link %}` tags we emit ourselves, so
 * the stored-XSS assertion is not "no tags" — it is "no tag the caller chose".
 * See `.claude/rules/sanitize-note-content-markdoc.md`.
 */
function markdocTagsIn(content: string) {
  return [...Markdoc.parse(content).walk()].filter(
    (node) => node.type === "tag"
  );
}

const from = new Date("2026-05-01T09:00:00Z");
const to = new Date("2026-05-05T18:00:00Z");

describe("getAssetModelAvailability", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
    // why: clearAllMocks only resets call history — `mockResolvedValue`
    // implementations from earlier describe blocks leak into later ones.
    // Re-default the aggregates so each test starts from a clean pool.
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(0);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue(null);
  });

  it("returns total − inCustody − reserved for a clean window", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(10);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 3 },
    });

    const result = await getAssetModelAvailability({
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from,
      to,
    });

    // 10 total − 1 custody − 2 concrete booking − 3 model-level requests = 4
    expect(result).toEqual({
      total: 10,
      inCustody: 1,
      reservedConcrete: 2,
      reservedViaRequest: 3,
      reserved: 5,
      available: 4,
    });
  });

  it("clamps `available` to zero when reserved exceeds total", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(2);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 2 },
    });

    const result = await getAssetModelAvailability({
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from,
      to,
    });

    expect(result.available).toBe(0);
  });

  it("omits the date-overlap filter when from/to are missing", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(5);

    await getAssetModelAvailability({
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from: null,
      to: null,
    });

    // The bookingAsset.aggregate `where.booking` must NOT include the
    // `OR: [{from:...}, ...]` overlap clause — non-windowed queries
    // count ALL active bookings as competing, which is the
    // conservative reading for DRAFT bookings without dates yet.
    const call = (
      db.bookingAsset.aggregate as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0];
    // @ts-expect-error inspecting mock arg
    expect(call?.[0]?.where?.booking?.OR).toBeUndefined();
  });

  it("excludes the current booking from reservation sums", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(0);

    await getAssetModelAvailability({
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from,
      to,
    });

    // Both aggregate calls must filter `bookingId: { not: <this> }`.
    const bookingAssetCall = (
      db.bookingAsset.aggregate as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0];
    const modelRequestCall = (
      db.bookingModelRequest.aggregate as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0];
    // @ts-expect-error inspecting mock arg
    expect(bookingAssetCall?.[0]?.where?.bookingId).toEqual({
      not: BOOKING_ID,
    });
    // @ts-expect-error inspecting mock arg
    expect(modelRequestCall?.[0]?.where?.bookingId).toEqual({
      not: BOOKING_ID,
    });
  });
});

describe("getAssetModelAvailability — injected client", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("reads through the supplied client instead of the global db", async () => {
    // A caller deciding whether a reservation fits passes its own `tx`. If
    // these counts run on the global client they sit outside that
    // transaction — they miss its uncommitted writes and take part in none
    // of its locks, which is what let two reservations claim one pool.
    //
    // why: this stub IS the subject of the test, not a dependency stood in
    // for convenience. It has to be a client distinct from the mocked `db`
    // so "which client did the reads go to" is observable at all; the four
    // delegates below are exactly the reads the function issues, and their
    // values are chosen to make the returned arithmetic checkable
    // (7 total − 1 in custody − 2 reserved = 4 available).
    const client = {
      asset: { count: vitest.fn().mockResolvedValue(7) },
      custody: {
        aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 1 } }),
      },
      bookingAsset: {
        aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 2 } }),
      },
      bookingModelRequest: {
        aggregate: vitest
          .fn()
          .mockResolvedValue({ _sum: { quantity: 0, fulfilledQuantity: 0 } }),
      },
    };

    const availability = await getAssetModelAvailability({
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from,
      to,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: client as any,
    });

    expect(client.asset.count).toHaveBeenCalledTimes(1);
    expect(availability.total).toBe(7);
    expect(availability.available).toBe(4);
    // The global client must not have been consulted at all.
    expect(db.asset.count).not.toHaveBeenCalled();
  });
});

describe("upsertBookingModelRequest", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
    // Default to a DRAFT booking so the status guard passes.
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      name: "Test",
      status: BookingStatus.DRAFT,
      from,
      to,
    });
    // why: clearAllMocks only resets call history — `mockResolvedValue`
    // implementations leak in from earlier describe blocks. Re-default the
    // pool and the "no existing row" case so each test starts from a create.
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(0);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);
    // @ts-expect-error mocked
    db.assetModel.findUnique.mockResolvedValue({
      id: MODEL_ID,
      name: "Dell Latitude 5550",
    });
  });

  it("locks the model pool before it measures availability", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(5);

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // Measuring a pool nobody has claimed is the race: two callers read the
    // same free count and both commit. Order is the assertion, not merely
    // that both happened.
    const lockOrder = (db.$queryRaw as ReturnType<typeof vitest.fn>).mock
      .invocationCallOrder[0];
    const readOrder = (db.asset.count as ReturnType<typeof vitest.fn>).mock
      .invocationCallOrder[0];

    expect(lockOrder).toBeDefined();
    expect(lockOrder).toBeLessThan(readOrder);
  });

  it("scopes the lock to the caller's workspace", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(5);

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 1,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // A foreign-org model id must match zero rows rather than take a real
    // lock on another tenant's row — the same rule the asset lock follows.
    const [strings, ...values] = (db.$queryRaw as ReturnType<typeof vitest.fn>)
      .mock.calls[0];
    expect((strings as TemplateStringsArray).join("?")).toContain(
      '"organizationId"'
    );
    expect(values).toEqual([MODEL_ID, ORG_ID]);
  });

  it("refuses a model that is not in the caller's workspace", async () => {
    expect.assertions(2);
    // The org-scoped lock matches nothing for a foreign model id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.$queryRaw as any).mockResolvedValue([]);

    await expect(
      upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: "model-from-another-org",
        quantity: 1,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);

    // Refused before any pool measurement happens.
    expect(db.asset.count).not.toHaveBeenCalled();
  });

  it("creates the row when quantity is within availability", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(5);

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    expect(db.bookingModelRequest.upsert).toHaveBeenCalledWith({
      where: {
        bookingId_assetModelId: {
          bookingId: BOOKING_ID,
          assetModelId: MODEL_ID,
        },
      },
      create: {
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
      },
      // Post-audit-trail schema: update also nulls `fulfilledAt` when
      // quantity rises above fulfilledQuantity (which is 0 for a fresh
      // row — existing is undefined, so existingFulfilled defaults to 0).
      update: { quantity: 3, fulfilledAt: null },
    });
  });

  it("rejects over-reservation when quantity > available", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(2);

    await expect(
      upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 5,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);
    expect(db.bookingModelRequest.upsert).not.toHaveBeenCalled();
  });

  it("rejects edits on ONGOING bookings", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      name: "Test",
      status: BookingStatus.ONGOING,
      from,
      to,
    });
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(10);

    await expect(
      upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 1,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);
    expect(db.bookingModelRequest.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity", async () => {
    expect.assertions(2);

    await expect(
      upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 0,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);
    expect(db.bookingModelRequest.upsert).not.toHaveBeenCalled();
  });

  describe("activity events", () => {
    it("records BOOKING_MODEL_REQUESTED when the reservation is created", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(5);

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      // The AssetModel is carried in `meta` — `ActivityEvent` has no
      // assetModelId column, so without this the event cannot say WHICH
      // model was committed to.
      expect(eventsOfAction("BOOKING_MODEL_REQUESTED")).toEqual([
        expect.objectContaining({
          entityType: "BOOKING",
          entityId: BOOKING_ID,
          bookingId: BOOKING_ID,
          actorUserId: USER_ID,
          meta: {
            assetModelId: MODEL_ID,
            assetModelName: "Dell Latitude 5550",
            quantity: 3,
          },
        }),
      ]);
      // A create is not a field change.
      expect(eventsOfAction("BOOKING_MODEL_REQUEST_CHANGED")).toEqual([]);
    });

    it("records a quantity field-change (not an umbrella event) when the reservation is edited", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(10);
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        quantity: 3,
        fulfilledQuantity: 0,
        fulfilledAt: null,
      });
      // The row exists, so the upsert runs its UPDATE branch — signal it
      // via the timestamps the service's `wasCreated` inspects.
      // @ts-expect-error mocked
      db.bookingModelRequest.upsert.mockResolvedValueOnce({
        id: "req-1",
        bookingId: "booking-1",
        assetModelId: "model-1",
        quantity: 3,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 5,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      // field/fromValue/toValue is what makes "who changed 3 → 5, and when?"
      // answerable without parsing note prose.
      expect(eventsOfAction("BOOKING_MODEL_REQUEST_CHANGED")).toEqual([
        expect.objectContaining({
          field: "quantity",
          fromValue: 3,
          toValue: 5,
          bookingId: BOOKING_ID,
          meta: {
            assetModelId: MODEL_ID,
            assetModelName: "Dell Latitude 5550",
          },
        }),
      ]);
      // Editing an existing row is not a new commitment.
      expect(eventsOfAction("BOOKING_MODEL_REQUESTED")).toEqual([]);
    });

    it("records a change, not a duplicate REQUESTED, when it loses a create race", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(10);
      // The pre-upsert read saw nothing (findUnique default: null), but a
      // concurrent transaction created the row first: the upsert serialized
      // on the unique constraint and ran its UPDATE branch. The result's
      // distinct timestamps are the only truthful signal.
      // @ts-expect-error mocked
      db.bookingModelRequest.upsert.mockResolvedValueOnce({
        id: "req-1",
        bookingId: "booking-1",
        assetModelId: "model-1",
        quantity: 5,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 5,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      // The transition is recorded (fromValue unknowable → null), and no
      // second "requested" event pads the audit trail.
      expect(eventsOfAction("BOOKING_MODEL_REQUEST_CHANGED")).toEqual([
        expect.objectContaining({ field: "quantity", toValue: 5 }),
      ]);
      expect(eventsOfAction("BOOKING_MODEL_REQUESTED")).toEqual([]);
    });

    it("preserves the original fulfilledAt when an unchanged quantity is re-saved", async () => {
      expect.assertions(2);
      const originallyFulfilledAt = new Date("2026-05-02T10:00:00Z");
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(10);
      // Already complete: 3 reserved, 3 scanned in, stamped back in May.
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        quantity: 3,
        fulfilledQuantity: 3,
        fulfilledAt: originallyFulfilledAt,
      });
      // The row exists, so the upsert runs its UPDATE branch — signal it
      // via the timestamps the service's `wasCreated` inspects.
      // @ts-expect-error mocked
      db.bookingModelRequest.upsert.mockResolvedValueOnce({
        id: "req-1",
        bookingId: "booking-1",
        assetModelId: "model-1",
        quantity: 3,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      const updateData = (
        db.bookingModelRequest.upsert as ReturnType<typeof vitest.fn>
      ).mock.calls[0]?.[0]?.update;

      // Re-saving an unchanged quantity is not a new fulfilment. Stamping
      // now() again would rewrite the only record of when the reservation
      // actually completed.
      expect(updateData.fulfilledAt).toBe(originallyFulfilledAt);
      // And the row never leaves the fulfilled state, so nothing changed.
      expect(recordedEvents()).toEqual([]);
    });

    it("records nothing when the submitted quantity is unchanged", async () => {
      expect.assertions(1);
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(10);
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        quantity: 3,
        fulfilledQuantity: 0,
        fulfilledAt: null,
      });
      // The row exists, so the upsert runs its UPDATE branch — signal it
      // via the timestamps the service's `wasCreated` inspects.
      // @ts-expect-error mocked
      db.bookingModelRequest.upsert.mockResolvedValueOnce({
        id: "req-1",
        bookingId: "booking-1",
        assetModelId: "model-1",
        quantity: 3,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      // A re-save that changes no field must not pad the audit trail.
      expect(recordedEvents()).toEqual([]);
    });

    it("records quantity and fulfilledAt as separate events when an edit closes the request out", async () => {
      expect.assertions(3);
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(10);
      // Three of five units already scanned in; the operator edits down to 3
      // to close the reservation out.
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        quantity: 5,
        fulfilledQuantity: 3,
        fulfilledAt: null,
      });
      // The row exists, so the upsert runs its UPDATE branch — signal it
      // via the timestamps the service's `wasCreated` inspects.
      // @ts-expect-error mocked
      db.bookingModelRequest.upsert.mockResolvedValueOnce({
        id: "req-1",
        bookingId: "booking-1",
        assetModelId: "model-1",
        quantity: 3,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      // Two fields moved, so two events — one umbrella "request updated" row
      // would make either change uncountable (record-event-payload-shapes).
      const changes = eventsOfAction("BOOKING_MODEL_REQUEST_CHANGED");
      expect(changes.map((event) => event.field)).toEqual([
        "quantity",
        "fulfilledAt",
      ]);
      expect(changes[0]).toEqual(
        expect.objectContaining({ fromValue: 5, toValue: 3 })
      );
      // Closing out by editing the quantity down is the one fulfilment path
      // with no scan behind it — nothing else in the trail would record it.
      expect(typeof changes[1].toValue).toBe("string");
    });

    it("records no event when the reservation is rejected", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(2);

      await expect(
        upsertBookingModelRequest({
          bookingId: BOOKING_ID,
          assetModelId: MODEL_ID,
          quantity: 5,
          organizationId: ORG_ID,
          userId: USER_ID,
        })
      ).rejects.toThrow(ShelfError);
      // The event lives inside the transaction, so a rejected reservation
      // leaves no trace claiming it happened.
      expect(db.activityEvent.create).not.toHaveBeenCalled();
    });

    it("supplies the actor snapshot rather than re-reading the user inside the transaction", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.asset.count.mockResolvedValue(5);

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(db.activityEvent.create).toHaveBeenCalled();
      // `recordEvent` only reads the user when the caller omits the snapshot.
      // A call here means a redundant read crept back into the tx window.
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });
  });

  it("cannot be used to inject a live Markdoc tag via the asset-model name", async () => {
    expect.assertions(3);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(5);
    // AssetModel.name is free-form user input and lands in the note as
    // literal text, so a raw `{% … %}` splice would be a stored XSS.
    // @ts-expect-error mocked
    db.assetModel.findUnique.mockResolvedValue({
      id: MODEL_ID,
      name: 'Dell{% link to="javascript:alert(document.cookie)" text="x" /%}',
    });

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    const content = (
      createSystemBookingNote as unknown as {
        mock: { calls: Array<[{ content: string }]> };
      }
    ).mock.calls[0][0].content;

    // Parse it exactly as the feed does. Pin the count first: `every`
    // is vacuously true on an empty array, so without this a change that
    // stopped emitting our own links would leave both guards below
    // asserting nothing. One actor link, and only that.
    const tags = markdocTagsIn(content);
    expect(tags).toHaveLength(1);
    // The only tag may be the actor link we emit ourselves...
    expect(tags.every((node) => node.tag === "link")).toBe(true);
    // ...and none of them may point anywhere the attacker chose.
    expect(
      tags.every(
        (node) => !/^javascript:/i.test(String(node.attributes?.to ?? ""))
      )
    ).toBe(true);
  });
});

describe("removeBookingModelRequest", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
    // why: clearAllMocks only resets call history — `mockResolvedValue`
    // implementations from earlier describe blocks leak into later ones.
    // Re-default the aggregates so each test starts from a clean pool.
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(0);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue(null);
  });

  it("deletes the row on a DRAFT booking", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.DRAFT,
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      assetModel: { name: "Dell Latitude 5550" },
    });

    await removeBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    expect(db.bookingModelRequest.delete).toHaveBeenCalledWith({
      where: {
        bookingId_assetModelId: {
          bookingId: BOOKING_ID,
          assetModelId: MODEL_ID,
        },
      },
    });
  });

  it("is idempotent when no request exists", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.DRAFT,
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);

    await removeBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    expect(db.bookingModelRequest.delete).not.toHaveBeenCalled();
  });

  it("rejects cancellation on ONGOING bookings", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.ONGOING,
    });

    await expect(
      removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);
    expect(db.bookingModelRequest.delete).not.toHaveBeenCalled();
  });

  describe("activity events", () => {
    it("records BOOKING_MODEL_REQUEST_REMOVED carrying the cancelled quantity", async () => {
      expect.assertions(1);
      // @ts-expect-error mocked
      db.booking.findUnique.mockResolvedValue({
        id: BOOKING_ID,
        status: BookingStatus.DRAFT,
      });
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        fulfilledQuantity: 0,
        assetModel: { name: "Dell Latitude 5550" },
      });

      await removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      // The row is gone after this, so the event's `meta` is the only record
      // left of how large the withdrawn commitment was.
      expect(eventsOfAction("BOOKING_MODEL_REQUEST_REMOVED")).toEqual([
        expect.objectContaining({
          entityType: "BOOKING",
          entityId: BOOKING_ID,
          bookingId: BOOKING_ID,
          actorUserId: USER_ID,
          meta: {
            assetModelId: MODEL_ID,
            assetModelName: "Dell Latitude 5550",
            quantity: 3,
          },
        }),
      ]);
    });

    it("states the cancelled unit count in the note", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.booking.findUnique.mockResolvedValue({
        id: BOOKING_ID,
        status: BookingStatus.DRAFT,
      });
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        fulfilledQuantity: 0,
        assetModel: { name: "Dell Latitude 5550" },
      });

      await removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      const content = (
        createSystemBookingNote as unknown as {
          mock: { calls: Array<[{ content: string }]> };
        }
      ).mock.calls[0][0].content;

      // Every sibling note in this file names the count; cancellation used to
      // be the outlier, reading "cancelled the model-level reservation for
      // Model" with the operator's 3 units nowhere in the trail.
      expect(content).toContain("**3 × Dell Latitude 5550**");
      expect(content).toContain("cancelled");
    });

    it("cannot be used to inject a live Markdoc tag via the asset-model name", async () => {
      expect.assertions(3);
      // @ts-expect-error mocked
      db.booking.findUnique.mockResolvedValue({
        id: BOOKING_ID,
        status: BookingStatus.DRAFT,
      });
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        fulfilledQuantity: 0,
        assetModel: {
          name: 'Dell{% link to="javascript:alert(document.cookie)" text="x" /%}',
        },
      });

      await removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      const content = (
        createSystemBookingNote as unknown as {
          mock: { calls: Array<[{ content: string }]> };
        }
      ).mock.calls[0][0].content;

      // Count first — `every` passes vacuously on an empty array, so this
      // is what stops both guards below silently covering nothing if the
      // note ever stopped emitting our own links. One actor link, and only
      // that.
      const tags = markdocTagsIn(content);
      expect(tags).toHaveLength(1);
      expect(tags.every((node) => node.tag === "link")).toBe(true);
      expect(
        tags.every(
          (node) => !/^javascript:/i.test(String(node.attributes?.to ?? ""))
        )
      ).toBe(true);
    });

    it("records nothing when there is no reservation to cancel", async () => {
      expect.assertions(1);
      // @ts-expect-error mocked
      db.booking.findUnique.mockResolvedValue({
        id: BOOKING_ID,
        status: BookingStatus.DRAFT,
      });
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue(null);

      await removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      // The idempotent no-op path must not report a cancellation.
      expect(recordedEvents()).toEqual([]);
    });
  });
});

describe("materializeModelRequestForAsset", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
    // why: clearAllMocks only resets call history — `mockResolvedValue`
    // implementations from earlier describe blocks leak into later ones.
    // Re-default the aggregates so each test starts from a clean pool.
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(0);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue(null);
  });

  // The service takes `tx` as a required arg — we pass the mocked `db`
  // directly because our `$transaction` mock routes callback tx back
  // to `db`, so calling `db.bookingModelRequest.*` is equivalent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = db as any;

  it("increments fulfilledQuantity on a happy-path scan", async () => {
    expect.assertions(3);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      fulfilledQuantity: 0,
      fulfilledAt: null,
      assetModel: { name: "Dell Latitude 5550" },
    });

    const result = await materializeModelRequestForAsset({
      bookingId: BOOKING_ID,
      asset: {
        id: "asset-1",
        title: "Laptop #1",
        assetModelId: MODEL_ID,
        type: AssetType.INDIVIDUAL,
      },
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // `requestId` is part of the contract, not incidental: the caller stamps
    // it onto the `BookingAsset` row it creates so the booking records WHICH
    // reservation each asset discharged. Dropping it silently would lose that
    // link with no other symptom.
    expect(result).toEqual({
      matched: true,
      requestId: "req-1",
      remaining: 2,
      modelName: "Dell Latitude 5550",
    });
    // The claim is a conditional atomic write. Assert the capacity predicate
    // is IN the statement — a pre-read guard plus an unconditional increment
    // is exactly the shape that over-filled the row under concurrency.
    const sql = (
      (vitest.mocked(db.$queryRaw).mock.calls[0]?.[0] as unknown as string[]) ??
      []
    ).join("?");
    expect(sql).toContain('"fulfilledQuantity" < "quantity"');
    // Row is NEVER deleted under the audit-trail schema.
    expect(db.bookingModelRequest.delete).not.toHaveBeenCalled();
  });

  it("stamps fulfilledAt when the last unit is assigned (never deletes)", async () => {
    expect.assertions(3);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 1,
      fulfilledQuantity: 0,
      fulfilledAt: null,
      assetModel: { name: "Dell Latitude 5550" },
    });

    const result = await materializeModelRequestForAsset({
      bookingId: BOOKING_ID,
      asset: {
        id: "asset-1",
        title: "Laptop #1",
        assetModelId: MODEL_ID,
        type: AssetType.INDIVIDUAL,
      },
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    expect(result).toEqual({
      matched: true,
      requestId: "req-1",
      remaining: 0,
      modelName: "Dell Latitude 5550",
    });
    // Update payload must include BOTH the incremented fulfilledQuantity
    // AND a fulfilledAt timestamp — this is the scan that completes the
    // reservation, so the row becomes historical.
    // The stamp is computed from the POST-write value inside the statement
    // (`CASE WHEN "fulfilledQuantity" + 1 >= "quantity"`), not from the
    // pre-write read — that gap is what let two concurrent claims both decide
    // "not complete" and leave the row delivered-but-unstamped, invisible to
    // the UI and still blocking check-out.
    const sql = (
      (vitest.mocked(db.$queryRaw).mock.calls[0]?.[0] as unknown as string[]) ??
      []
    ).join("?");
    expect(sql).toContain('"fulfilledQuantity" + 1 >= "quantity"');
    // COALESCE keeps an existing stamp rather than moving it on a later write.
    expect(sql).toContain("COALESCE");
  });

  it("returns matched:false when the asset has no model", async () => {
    expect.assertions(2);

    const result = await materializeModelRequestForAsset({
      bookingId: BOOKING_ID,
      asset: {
        id: "asset-1",
        title: "Laptop #1",
        assetModelId: null,
        type: AssetType.INDIVIDUAL,
      },
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    expect(result).toEqual({ matched: false });
    expect(db.bookingModelRequest.findUnique).not.toHaveBeenCalled();
  });

  it("returns matched:false when no request for the asset's model exists", async () => {
    expect.assertions(3);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);

    const result = await materializeModelRequestForAsset({
      bookingId: BOOKING_ID,
      asset: {
        id: "asset-1",
        title: "Laptop #1",
        assetModelId: MODEL_ID,
        type: AssetType.INDIVIDUAL,
      },
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    expect(result).toEqual({ matched: false });
    expect(db.bookingModelRequest.update).not.toHaveBeenCalled();
    expect(db.bookingModelRequest.delete).not.toHaveBeenCalled();
  });

  describe("activity events", () => {
    it("records one BOOKING_MODEL_REQUEST_FULFILLED per unit, joined to the concrete asset", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        fulfilledQuantity: 0,
        fulfilledAt: null,
        assetModel: { name: "Dell Latitude 5550" },
      });

      await materializeModelRequestForAsset({
        bookingId: BOOKING_ID,
        asset: {
          id: "asset-1",
          title: "Laptop #1",
          assetModelId: MODEL_ID,
          type: AssetType.INDIVIDUAL,
        },
        organizationId: ORG_ID,
        userId: USER_ID,
        tx,
      });

      // `assetId` is the join from "3 × Dell were promised" back to the
      // serial numbers that satisfied the promise. One event per UNIT, so
      // the count of events IS the count of units fulfilled.
      expect(eventsOfAction("BOOKING_MODEL_REQUEST_FULFILLED")).toEqual([
        expect.objectContaining({
          entityType: "BOOKING",
          entityId: BOOKING_ID,
          bookingId: BOOKING_ID,
          assetId: "asset-1",
          actorUserId: USER_ID,
          meta: {
            assetModelId: MODEL_ID,
            assetModelName: "Dell Latitude 5550",
            quantity: 3,
            fulfilledQuantity: 1,
            remaining: 2,
          },
        }),
      ]);
      // Two units still outstanding — the request has not closed.
      expect(eventsOfAction("BOOKING_MODEL_REQUEST_CHANGED")).toEqual([]);
    });

    it("records the fulfilledAt change with the same timestamp written to the row", async () => {
      expect.assertions(3);
      // The claim simulator mutates this row the way the statement mutates the
      // real one, so it is also the record of what got written.
      const staged: { fulfilledAt: Date | null } & Record<string, unknown> = {
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 1,
        fulfilledQuantity: 0,
        fulfilledAt: null,
        assetModel: { name: "Dell Latitude 5550" },
      };
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue(staged);

      await materializeModelRequestForAsset({
        bookingId: BOOKING_ID,
        asset: {
          id: "asset-1",
          title: "Laptop #1",
          assetModelId: MODEL_ID,
          type: AssetType.INDIVIDUAL,
        },
        organizationId: ORG_ID,
        userId: USER_ID,
        tx,
      });

      const changes = eventsOfAction("BOOKING_MODEL_REQUEST_CHANGED");
      expect(changes.map((event) => event.field)).toEqual(["fulfilledAt"]);
      // The stamp is computed inside the claim statement and read back from
      // its RETURNING, so the column and the event reporting it cannot
      // disagree — there is only one value.
      // Asserted non-null first: `?.` alone would let a never-stamped row and
      // a never-emitted value match each other as undefined.
      const writtenAt = staged.fulfilledAt;
      expect(writtenAt).toBeInstanceOf(Date);
      expect(changes[0].toValue).toBe(writtenAt?.toISOString());
    });

    it("records no event when the scan matches no outstanding request", async () => {
      expect.assertions(1);
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 2,
        fulfilledQuantity: 2,
        fulfilledAt: new Date("2026-05-02T10:00:00Z"),
        assetModel: { name: "Dell Latitude 5550" },
      });

      await materializeModelRequestForAsset({
        bookingId: BOOKING_ID,
        asset: {
          id: "asset-1",
          title: "Laptop #1",
          assetModelId: MODEL_ID,
          type: AssetType.INDIVIDUAL,
        },
        organizationId: ORG_ID,
        userId: USER_ID,
        tx,
      });

      // Over-count scans fall through to the caller's direct-booking path,
      // which emits its own BOOKING_ASSETS_ADDED. Recording a fulfilment
      // here would double-count the unit.
      expect(recordedEvents()).toEqual([]);
    });

    it("supplies the actor snapshot rather than re-reading the user per scanned asset", async () => {
      expect.assertions(2);
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 3,
        fulfilledQuantity: 0,
        fulfilledAt: null,
        assetModel: { name: "Dell Latitude 5550" },
      });

      await materializeModelRequestForAsset({
        bookingId: BOOKING_ID,
        asset: {
          id: "asset-1",
          title: "Laptop #1",
          assetModelId: MODEL_ID,
          type: AssetType.INDIVIDUAL,
        },
        organizationId: ORG_ID,
        userId: USER_ID,
        tx,
      });

      expect(db.activityEvent.create).toHaveBeenCalled();
      // This runs once per scanned asset inside the caller's transaction —
      // an extra user read here is a per-asset round-trip against the
      // interactive-tx budget (the P2028 class).
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });
  });

  it("cannot be used to inject a live Markdoc tag via the asset-model name or asset title", async () => {
    expect.assertions(3);
    // Both values are free-form user input spliced into the scan note.
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      fulfilledQuantity: 0,
      fulfilledAt: null,
      assetModel: {
        name: 'Dell{% link to="javascript:alert(document.cookie)" text="x" /%}',
      },
    });

    await materializeModelRequestForAsset({
      bookingId: BOOKING_ID,
      asset: {
        id: "asset-1",
        title: '" /%}{% link to="javascript:alert(1)" text="pwned',
        assetModelId: MODEL_ID,
        type: AssetType.INDIVIDUAL,
      },
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    const content = (
      db.bookingNote.create as unknown as {
        mock: { calls: Array<[{ data: { content: string } }]> };
      }
    ).mock.calls[0][0].data.content;

    // Count first — `every` passes vacuously on an empty array, so this is
    // what stops both guards below silently covering nothing if the note
    // ever stopped emitting our own links. This note carries two: the
    // actor link and the scanned asset's link.
    const tags = markdocTagsIn(content);
    expect(tags).toHaveLength(2);
    // Only the actor and asset links we emit ourselves...
    expect(tags.every((node) => node.tag === "link")).toBe(true);
    // ...and none of them points anywhere the attacker chose.
    expect(
      tags.every(
        (node) => !/^javascript:/i.test(String(node.attributes?.to ?? ""))
      )
    ).toBe(true);
  });
});

describe("getBookingModelTabData", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
    // why: clearAllMocks only resets call history — `mockResolvedValue`
    // implementations from earlier describe blocks leak into later ones.
    // Re-default the aggregates so each test starts from a clean pool.
    // @ts-expect-error mocked
    db.assetModel.count.mockResolvedValue(0);
    // @ts-expect-error mocked
    db.assetModel.findMany.mockResolvedValue([]);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(0);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 0 },
    });
  });

  /** Minimal `BookingForModelTab` fixture with no model requests. */
  const emptyBooking = {
    id: BOOKING_ID,
    from,
    to,
    modelRequests: [],
  };

  it("hides the Models tab and returns empty lists when the org has no models", async () => {
    expect.assertions(5);
    // @ts-expect-error mocked
    db.assetModel.count.mockResolvedValue(0);

    const result = await getBookingModelTabData({
      organizationId: ORG_ID,
      booking: emptyBooking,
    });

    expect(result.showModelsTab).toBe(false);
    expect(result.assetModels).toEqual([]);
    expect(result.initialAssetModels).toEqual([]);
    expect(result.totalAssetModels).toBe(0);
    // `booking.modelRequests` is still projected even with no models —
    // the two are independent (a model could be deleted after a request
    // was made against it).
    expect(result.modelRequests).toEqual([]);
    // `findMany` must be skipped entirely when the count is 0 — no point
    // querying a picker list nobody will see.
  });

  it("does not query the model list when the org has no models", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.assetModel.count.mockResolvedValue(0);

    await getBookingModelTabData({
      organizationId: ORG_ID,
      booking: emptyBooking,
    });

    expect(db.assetModel.findMany).not.toHaveBeenCalled();
  });

  it("carries per-model availability into assetModels + initialAssetModels", async () => {
    expect.assertions(4);
    // @ts-expect-error mocked
    db.assetModel.count.mockResolvedValue(2);
    // @ts-expect-error mocked
    db.assetModel.findMany.mockResolvedValue([
      { id: "model-1", name: "Dell Latitude 5550" },
      { id: "model-2", name: "MacBook Pro 16" },
    ]);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(10);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({ _sum: { quantity: 2 } });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 3 },
    });

    const result = await getBookingModelTabData({
      organizationId: ORG_ID,
      booking: emptyBooking,
    });

    expect(result.showModelsTab).toBe(true);
    // 10 total − 1 custody − 2 concrete − 3 via request = 4 available
    expect(result.assetModels).toEqual([
      {
        id: "model-1",
        name: "Dell Latitude 5550",
        total: 10,
        available: 4,
        reservedConcrete: 2,
        reservedViaRequest: 3,
        inCustody: 1,
      },
      {
        id: "model-2",
        name: "MacBook Pro 16",
        total: 10,
        available: 4,
        reservedConcrete: 2,
        reservedViaRequest: 3,
        inCustody: 1,
      },
    ]);
    // `initialAssetModels` mirrors `assetModels` with fields nested under
    // `metadata`, shaped for the `DynamicSelect` picker.
    expect(result.initialAssetModels).toEqual([
      {
        id: "model-1",
        name: "Dell Latitude 5550",
        metadata: {
          total: 10,
          available: 4,
          reservedConcrete: 2,
          reservedViaRequest: 3,
          inCustody: 1,
        },
      },
      {
        id: "model-2",
        name: "MacBook Pro 16",
        metadata: {
          total: 10,
          available: 4,
          reservedConcrete: 2,
          reservedViaRequest: 3,
          inCustody: 1,
        },
      },
    ]);
    expect(result.totalAssetModels).toBe(2);
  });

  it("projects modelRequests: assetModelName, ISO date, and null pass-through", async () => {
    expect.assertions(1);

    const fulfilledAt = new Date("2026-05-02T10:00:00Z");
    const booking = {
      id: BOOKING_ID,
      from,
      to,
      modelRequests: [
        {
          assetModelId: "model-1",
          quantity: 3,
          fulfilledQuantity: 3,
          fulfilledAt,
          assetModel: { name: "Dell Latitude 5550" },
        },
        {
          assetModelId: "model-2",
          quantity: 2,
          fulfilledQuantity: 0,
          fulfilledAt: null,
          assetModel: { name: "MacBook Pro 16" },
        },
      ],
    };

    const result = await getBookingModelTabData({
      organizationId: ORG_ID,
      booking,
    });

    expect(result.modelRequests).toEqual([
      {
        assetModelId: "model-1",
        assetModelName: "Dell Latitude 5550",
        quantity: 3,
        fulfilledQuantity: 3,
        fulfilledAt: fulfilledAt.toISOString(),
      },
      {
        assetModelId: "model-2",
        assetModelName: "MacBook Pro 16",
        quantity: 2,
        fulfilledQuantity: 0,
        fulfilledAt: null,
      },
    ]);
  });

  it("scopes the model count + list to the caller's organizationId", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.assetModel.count.mockResolvedValue(1);
    // @ts-expect-error mocked
    db.assetModel.findMany.mockResolvedValue([
      { id: "model-1", name: "Dell Latitude 5550" },
    ]);

    await getBookingModelTabData({
      organizationId: ORG_ID,
      booking: emptyBooking,
    });

    // A model belonging to another org must never leak into this org's
    // picker — both the count and the list query must be scoped.
    expect(db.assetModel.count).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
    });
    const findManyCall = (
      db.assetModel.findMany as ReturnType<typeof vitest.fn>
    ).mock.calls[0]?.[0];
    expect(findManyCall?.where).toEqual({ organizationId: ORG_ID });
  });
});

/**
 * `fulfilModelRequestsForAssets` is the chokepoint every add-assets surface
 * routes through — web "Manage assets", the web scanner, the asset index and
 * the mobile API. Its guarantees are what make those surfaces agree, so they
 * are pinned here rather than left to whichever caller happens to be tested.
 */
describe("fulfilModelRequestsForAssets", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = db as any;

  const asset = (id: string, assetModelId: string | null = MODEL_ID) => ({
    id,
    title: `Asset ${id}`,
    assetModelId,
    type: AssetType.INDIVIDUAL,
  });

  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);
  });

  it("returns the reservation each asset discharged, keyed by asset", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 5,
      fulfilledQuantity: 0,
      fulfilledAt: null,
      assetModel: { name: "Dell Latitude 5550" },
    });

    const result = await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: [asset("asset-1")],
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // The map IS the provenance the caller persists. An empty map here means
    // `BookingAsset.bookingModelRequestId` never gets stamped.
    expect(result).toEqual(new Map([["asset-1", "req-1"]]));
  });

  it("omits assets that matched no outstanding reservation", async () => {
    expect.assertions(1);
    // findUnique default is null — no request exists for this model.
    const result = await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: [asset("asset-1"), asset("asset-2", null)],
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // Not an error: adding assets to a booking with no reservations is the
    // overwhelmingly common case.
    expect(result).toEqual(new Map());
  });

  it("decrements once per asset when several units of one model arrive together", async () => {
    expect.assertions(2);
    // A single 3-unit reservation, read fresh before each write. The service
    // must see the previous increment, so the mock advances the counter the
    // way the database would.
    // ONE mutable row, so the claim simulator's increment is visible to the
    // loop's next read — exactly how a committed row behaves.
    const row = {
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      fulfilledQuantity: 0,
      fulfilledAt: null as Date | null,
      assetModel: { name: "Dell Latitude 5550" },
    };
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockImplementation(() =>
      Promise.resolve(row)
    );

    const result = await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: [asset("a1"), asset("a2"), asset("a3")],
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // Three physical units delivered against a 3-unit promise must drain it
    // exactly. Running these concurrently would let two reads observe the
    // same `fulfilledQuantity` and lose an increment — which is why the
    // helper loops sequentially.
    expect(row.fulfilledQuantity).toBe(3);
    expect(result.size).toBe(3);
  });

  it("stops decrementing once the reservation is full, so extras are plain assets", async () => {
    expect.assertions(2);
    const row = {
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 1,
      fulfilledQuantity: 0,
      fulfilledAt: null as Date | null,
      assetModel: { name: "Dell Latitude 5550" },
    };
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockImplementation(() =>
      Promise.resolve(row)
    );

    const result = await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: [asset("a1"), asset("a2"), asset("a3")],
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // Over-delivery is legitimate — the operator may want more than they
    // reserved. The extras join the booking as ordinary assets; only the
    // first discharges the promise, so only it carries provenance.
    expect(row.fulfilledQuantity).toBe(1);
    expect(result).toEqual(new Map([["a1", "req-1"]]));
  });

  it("fulfils even when the caller threads no actor through", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 1,
      fulfilledQuantity: 0,
      fulfilledAt: null,
      assetModel: { name: "Dell Latitude 5550" },
    });

    // `api/assets.add-to-booking` omits `userId` because it writes its own
    // user-attributed note. Fulfilment must not depend on attribution: a
    // reservation that survived for want of an actor would hard-block
    // check-out.
    const result = await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: [asset("asset-1")],
      organizationId: ORG_ID,
      tx,
    });

    expect(result).toEqual(new Map([["asset-1", "req-1"]]));
    // The note is still written, in the system voice.
    expect(db.bookingNote.create).toHaveBeenCalled();
  });
});

/**
 * The unit claim under concurrency.
 *
 * Nothing exercised this before: the previous test asserted the update PAYLOAD
 * (`{ increment: 1 }`), which says nothing about what happens when two
 * transactions race. That gap is how a fix for the lost update shipped while
 * introducing a worse failure — a row delivered in full but never stamped,
 * invisible to every UI surface and still hard-blocking check-out.
 */
describe("materializeModelRequestForAsset — concurrent claims", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = db as any;

  const asset = {
    id: "asset-1",
    title: "Laptop #1",
    assetModelId: MODEL_ID,
    type: AssetType.INDIVIDUAL,
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
  });

  it("refuses the claim when another transaction took the last unit", async () => {
    expect.assertions(2);

    // Staged as already full — the same state a concurrent transaction leaves
    // behind after taking the final unit between our read and our write.
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 1,
      fulfilledQuantity: 1,
      fulfilledAt: null,
      assetModel: { name: "Dell Latitude 5550" },
    });

    const result = await materializeModelRequestForAsset({
      bookingId: BOOKING_ID,
      asset,
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // The loser reports no match, so its asset lands as an ordinary add rather
    // than over-filling the reservation to 2/1.
    expect(result).toEqual({ matched: false });
    // And writes no note — a countdown line for a unit it never claimed would
    // put a lie in the activity feed.
    expect(db.bookingNote.create).not.toHaveBeenCalled();
  });

  it("never leaves a request delivered-in-full but unstamped", async () => {
    expect.assertions(2);

    const row = {
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 2,
      fulfilledQuantity: 0,
      fulfilledAt: null as Date | null,
      assetModel: { name: "Dell Latitude 5550" },
    };
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockImplementation(() =>
      Promise.resolve(row)
    );

    // Two claims against one 2-unit reservation.
    for (const id of ["asset-1", "asset-2"]) {
      await materializeModelRequestForAsset({
        bookingId: BOOKING_ID,
        asset: { ...asset, id },
        organizationId: ORG_ID,
        userId: USER_ID,
        tx,
      });
    }

    expect(row.fulfilledQuantity).toBe(2);
    // The unrecoverable state: full by unit count, no stamp. The UI hides it
    // (`2 < 2` is false) while the checkout guard blocks on it, and
    // `removeBookingModelRequest` refuses to delete it. Nothing to click.
    expect(row.fulfilledAt).not.toBeNull();
  });
});
