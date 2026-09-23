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
  assertModelUnitsNotReservedElsewhere,
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
      // why: `readOwnNamedUnits` reads the units a booking already holds of a
      // model, and whether a custodian has any of them, through `asset` rather
      // than the pivot — one row per unit, custody included.
      findMany: vitest.fn().mockResolvedValue([]),
    },
    assetModel: {
      findUnique: vitest
        .fn()
        .mockResolvedValue({ id: "model-1", name: "Dell Latitude 5550" }),
      count: vitest.fn().mockResolvedValue(0),
      // why: shared by the Models tab seed list and by the reservation
      // guard's error message (which names the models that do not fit).
      findMany: vitest.fn().mockResolvedValue([]),
    },
    booking: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    bookingAsset: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      // why: `assertModelUnitsNotReservedElsewhere` reads the standalone units
      // the booking already holds of a model, which count on the claiming
      // side. Default to none; the guard's tests stage held rows per case.
      findMany: vitest.fn().mockResolvedValue([]),
    },
    bookingModelRequest: {
      // why: `fulfilModelRequestsForAssets` short-circuits on a count of the
      // booking's outstanding reservations before doing any per-asset work
      // (it avoids one round-trip per asset inside the caller's transaction).
      // Default to 1 so the existing suites exercise the loop.
      count: vitest.fn().mockResolvedValue(1),
      // why: `assertModelUnitsNotReservedElsewhere` exempts models the booking
      // reserves itself, read through this query. Default to none so the
      // guard measures every model unless a test stages an own request.
      findMany: vitest.fn().mockResolvedValue([]),
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
      // why: cancellation deletes through `deleteMany` so the
      // "nothing assigned" guard rides in the statement's own WHERE clause.
      deleteMany: vitest.fn().mockResolvedValue({ count: 1 }),
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
      const sql = Array.isArray(strings) ? strings.join("") : "";
      if (sql.includes('"AssetModel"')) {
        return [{ id: MODEL_ID }];
      }
      // why: the reservation-row lock is a third raw statement reaching this
      // stub. It must report whether the row exists and change nothing —
      // falling through to the claim branch below would silently increment
      // `fulfilledQuantity` on every upsert the suite runs.
      if (sql.includes("FOR UPDATE") && sql.includes('"BookingModelRequest"')) {
        const locked = await (
          db.bookingModelRequest.findUnique as ReturnType<typeof vitest.fn>
        )();
        return locked ? [{ id: locked.id ?? "req-1" }] : [];
      }
      const row = await (
        db.bookingModelRequest.findUnique as ReturnType<typeof vitest.fn>
      )();
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

/**
 * Raw statements issued this test, in call order, with the SQL flattened so a
 * test can name the table it is asserting about rather than an index. Several
 * raw statements reach the same mock, and indexing into `calls` couples every
 * assertion to how many locks the code happens to take.
 */
function rawStatements() {
  const mock = (db.$queryRaw as ReturnType<typeof vitest.fn>).mock;
  return mock.calls.map((call, index) => ({
    sql: (call[0] as TemplateStringsArray).join("?"),
    values: call.slice(1),
    order: mock.invocationCallOrder[index],
  }));
}

/** The single statement locking `table`, or undefined when none was issued. */
function lockOn(table: string) {
  return rawStatements().find(
    (statement) =>
      statement.sql.includes(`"${table}"`) &&
      statement.sql.includes("FOR UPDATE")
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
    // why: the reservation guard now also asks what this booking already
    // holds by name; default to holding nothing so each test states its own.
    // @ts-expect-error mocked
    db.asset.findMany.mockResolvedValue([]);
    // @ts-expect-error mocked
    db.assetModel.findUnique.mockResolvedValue({
      id: MODEL_ID,
      name: "Dell Latitude 5550",
    });
  });

  it("counts the units the booking already holds by name against the pool", async () => {
    expect.assertions(3);
    // Three units exist and nobody else has claimed any, but this booking
    // already holds two of them by name. Reserving three more by model would
    // promise five units out of three.
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(3);
    // @ts-expect-error mocked
    db.asset.findMany.mockResolvedValue([
      { id: "asset-held-1", assetModelId: MODEL_ID, custody: [] },
      { id: "asset-held-2", assetModelId: MODEL_ID, custody: [] },
    ]);

    const error = await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      organizationId: ORG_ID,
      userId: USER_ID,
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain("Only 1 can be reserved in this window.");
    expect(db.bookingModelRequest.upsert).not.toHaveBeenCalled();
  });

  it("does not count a held unit a custodian has, which the pool already deducted", async () => {
    expect.assertions(2);
    // Two units, one of them in a custodian's hands and named by this
    // booking. The pool already subtracted it, so naming it takes nothing.
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(2);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });
    // @ts-expect-error mocked
    db.asset.findMany.mockResolvedValue([
      { id: "asset-held-1", assetModelId: MODEL_ID, custody: [{ id: "c-1" }] },
    ]);

    await expect(
      upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 1,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).resolves.toBeDefined();
    expect(db.bookingModelRequest.upsert).toHaveBeenCalled();
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

  it("locks this booking's reservation row before it reads it", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(10);
    // The scenario, not incidental data: ten units promised and eight
    // already on the booking is the state a concurrent scan can move under
    // the reader's feet, so it is what makes the ordering below matter.
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      quantity: 10,
      fulfilledQuantity: 8,
      fulfilledAt: null,
    });

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 9,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // Everything this function decides — the floor, whether the write is a
    // reduction, the completion stamp — comes off that read. Taken without
    // the row lock it is a pre-write snapshot, and a scan committing between
    // the read and the write lands `fulfilledQuantity` above `quantity`.
    // The pool lock cannot stand in: a scan that fits inside the
    // reservation's own remaining count never takes one (see the early
    // `continue` in `assertModelUnitsNotReservedElsewhere`).
    const rowLock = lockOn("BookingModelRequest");
    const readOrder = (
      db.bookingModelRequest.findUnique as ReturnType<typeof vitest.fn>
    ).mock.invocationCallOrder[0];

    expect(rowLock).toBeDefined();
    expect(rowLock!.order).toBeLessThan(readOrder);
  });

  it("takes the pool lock before the reservation row lock", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(10);

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    // Assignment takes these two in this order (pool locks first in
    // `assertModelUnitsNotReservedElsewhere`, then the row via its claim
    // UPDATE). Taking them the other way round here is a lock-order
    // inversion, which is a deadlock rather than a wrong answer.
    expect(lockOn("AssetModel")!.order).toBeLessThan(
      lockOn("BookingModelRequest")!.order
    );
  });

  it("scopes the reservation row lock to this booking and model", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(10);

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    expect(lockOn("BookingModelRequest")!.values).toEqual([
      BOOKING_ID,
      MODEL_ID,
    ]);
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

  it("releases units that never turned up, on an ONGOING booking", async () => {
    expect.assertions(1);
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
    // Ten promised, eight collected and taken out — the other two are still
    // on the shelf and the booking is never getting them.
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      quantity: 10,
      fulfilledQuantity: 8,
      fulfilledAt: null,
    });
    // @ts-expect-error mocked
    db.asset.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        id: `asset-out-${index}`,
        assetModelId: MODEL_ID,
        custody: [],
      }))
    );

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 8,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    expect(db.bookingModelRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ quantity: 8 }),
      })
    );
  });

  it("adjusts the reservation on an OVERDUE booking", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      name: "Test",
      status: BookingStatus.OVERDUE,
      from,
      to,
    });
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(10);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      quantity: 5,
      fulfilledQuantity: 0,
      fulfilledAt: null,
    });

    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 2,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    expect(db.bookingModelRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ quantity: 2 }),
      })
    );
  });

  it("lets a reservation come down even when the pool no longer covers it", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      name: "Test",
      status: BookingStatus.ONGOING,
      from,
      to,
    });
    // The workspace now owns fewer units of this model than the booking is
    // holding — assets were retired, or moved into custody, after it went out.
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(2);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      quantity: 10,
      fulfilledQuantity: 8,
      fulfilledAt: null,
    });
    // @ts-expect-error mocked
    db.asset.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        id: `asset-out-${index}`,
        assetModelId: MODEL_ID,
        custody: [],
      }))
    );

    // Measuring the pool would refuse this at every quantity, stranding the
    // two unassigned units on the booking for good. Giving units back can
    // never need headroom.
    await upsertBookingModelRequest({
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 8,
      organizationId: ORG_ID,
      userId: USER_ID,
    });

    expect(db.bookingModelRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ quantity: 8 }),
      })
    );
  });

  it("refuses to drop a live booking's reservation below the units already assigned", async () => {
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
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      quantity: 10,
      fulfilledQuantity: 8,
      fulfilledAt: null,
    });

    // Eight units are on the booking. Reserving five would claim fewer units
    // than the booking is already holding.
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

  it.each([
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.ARCHIVED,
  ])("rejects edits once the booking is %s", async (status) => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      name: "Test",
      status,
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

    it("records the release and closes the request out on a live booking", async () => {
      expect.assertions(3);
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
      // @ts-expect-error mocked
      db.bookingModelRequest.findUnique.mockResolvedValue({
        quantity: 10,
        fulfilledQuantity: 8,
        fulfilledAt: null,
      });
      // @ts-expect-error mocked
      db.bookingModelRequest.upsert.mockResolvedValueOnce({
        id: "req-1",
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 8,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      });

      await upsertBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        quantity: 8,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      const changes = eventsOfAction("BOOKING_MODEL_REQUEST_CHANGED");
      expect(changes.map((event) => event.field)).toEqual([
        "quantity",
        "fulfilledAt",
      ]);
      expect(changes[0]).toEqual(
        expect.objectContaining({ fromValue: 10, toValue: 8 })
      );
      // The activity feed has to state what the booking no longer owes, or
      // the two released units just vanish from its history.
      const content = (
        createSystemBookingNote as unknown as {
          mock: { calls: Array<[{ content: string }]> };
        }
      ).mock.calls[0][0].content;
      expect(content).toContain("from **10** to **8**");
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
    // why: `mockResolvedValue` replaces the implementation for good, and
    // `clearAllMocks` only wipes call history — so the one test that stages a
    // zero-row delete would answer every test after it. Re-default here.
    // @ts-expect-error mocked
    db.bookingModelRequest.deleteMany.mockResolvedValue({ count: 1 });
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

    expect(db.bookingModelRequest.deleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        fulfilledQuantity: 0,
      },
    });
  });

  it("locks the reservation row before the assigned-units guard", async () => {
    expect.assertions(2);
    // An ONGOING booking with a reservation nothing has been assigned to:
    // the one state where cancelling is still allowed, and so the only one
    // in which the guard's read can be raced by an arriving unit.
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.ONGOING,
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

    // The "nothing assigned yet" guard lives in application code, so it is
    // only as good as the read behind it. Unlocked, a scan can fill the
    // reservation between the guard and the delete, and the FK's ON DELETE
    // SET NULL then strips that asset's `bookingModelRequestId` — the exact
    // provenance this guard exists to keep.
    const rowLock = lockOn("BookingModelRequest");
    const readOrder = (
      db.bookingModelRequest.findUnique as ReturnType<typeof vitest.fn>
    ).mock.invocationCallOrder[0];

    expect(rowLock).toBeDefined();
    expect(rowLock!.order).toBeLessThan(readOrder);
  });

  it("refuses the cancellation when the delete matches nothing", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.ONGOING,
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
    // The guard passed, and the write still matched nothing — the only way
    // that happens is a unit arriving in between. Refuse rather than report
    // a cancellation that did not occur.
    // @ts-expect-error mocked
    db.bookingModelRequest.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);
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

    expect(db.bookingModelRequest.deleteMany).not.toHaveBeenCalled();
  });

  it("cancels a reservation nothing was assigned to on an ONGOING booking", async () => {
    expect.assertions(1);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.ONGOING,
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

    expect(db.bookingModelRequest.deleteMany).toHaveBeenCalled();
  });

  it("refuses to cancel a reservation that already has units assigned", async () => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.ONGOING,
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 3,
      fulfilledQuantity: 2,
      assetModel: { name: "Dell Latitude 5550" },
    });

    // Deleting the row would orphan the two concrete assets it explains.
    // Reducing the quantity to 2 is the way to close it out.
    await expect(
      removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);
    expect(db.bookingModelRequest.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.ARCHIVED,
  ])("rejects cancellation once the booking is %s", async (status) => {
    expect.assertions(2);
    // @ts-expect-error mocked
    db.booking.findUnique.mockResolvedValue({
      id: BOOKING_ID,
      status,
    });

    await expect(
      removeBookingModelRequest({
        bookingId: BOOKING_ID,
        assetModelId: MODEL_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      })
    ).rejects.toThrow(ShelfError);
    expect(db.bookingModelRequest.deleteMany).not.toHaveBeenCalled();
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
    expect(db.bookingModelRequest.deleteMany).not.toHaveBeenCalled();
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
    expect(db.bookingModelRequest.deleteMany).not.toHaveBeenCalled();
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

  it("refuses a second claim from an asset that already answered on this booking", async () => {
    expect.assertions(2);
    // why: the asset holds a row carrying a stamp, which is the record that it
    // has already discharged a unit here — however it arrived, loose or in a
    // kit.
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([{ assetId: "asset-1" }]);
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue({
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity: 5,
      fulfilledQuantity: 1,
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

    // One physical unit, one reserved unit. Claiming again would report a
    // 2-unit reservation as satisfied with one camera behind it.
    expect(result).toEqual(new Map());
    expect(db.bookingModelRequest.findUnique).not.toHaveBeenCalled();
  });

  it("still claims for an asset already on the booking whose row carries no stamp", async () => {
    expect.assertions(1);
    // why: the read is scoped to stamped rows, so an unstamped row simply does
    // not come back — the asset is present but has discharged nothing.
    // @ts-expect-error mocked
    db.bookingAsset.findMany.mockResolvedValue([]);
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

    expect(result).toEqual(new Map([["asset-1", "req-1"]]));
  });

  it("reads the already-claimed assets once for the whole call", async () => {
    expect.assertions(2);

    await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: [asset("asset-1"), asset("asset-2"), asset("asset-3")],
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // One indexed read, not one per asset: this runs inside the caller's
    // interactive transaction, where a bulk add can carry hundreds of assets.
    expect(db.bookingAsset.findMany).toHaveBeenCalledTimes(1);
    expect(db.bookingAsset.findMany).toHaveBeenCalledWith({
      where: {
        bookingId: BOOKING_ID,
        assetId: { in: ["asset-1", "asset-2", "asset-3"] },
        bookingModelRequestId: { not: null },
      },
      select: { assetId: true },
    });
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

describe("assertModelUnitsNotReservedElsewhere", () => {
  const OTHER_MODEL_ID = "model-0";
  const NEW_UNIT = {
    id: "asset-new",
    title: "Suturing Practice Pad",
    assetModelId: MODEL_ID,
  };
  const SECOND_NEW_UNIT = {
    id: "asset-new-2",
    title: "Arterial Puncture Simulator",
    assetModelId: MODEL_ID,
  };

  type RequestRow = {
    assetModelId: string;
    quantity: number;
    fulfilledQuantity: number;
  };

  /**
   * The guard reads `bookingModelRequest.findMany` twice for different
   * questions — what this booking is still owed, and what OTHER bookings are —
   * so the stub answers by the scope of the `where`, which is the same thing
   * that distinguishes them in the service.
   */
  let ownRequestRows: RequestRow[] = [];
  let foreignRequestRows: RequestRow[] = [];

  /** Stages a pool: total units, held in custody, other bookings' claims. */
  function stagePool({
    total,
    inCustody = 0,
    reservedElsewhere = 0,
    requestedElsewhere = 0,
  }: {
    total: number;
    inCustody?: number;
    reservedElsewhere?: number;
    requestedElsewhere?: number;
  }) {
    // @ts-expect-error mocked
    db.asset.count.mockResolvedValue(total);
    // @ts-expect-error mocked
    db.custody.aggregate.mockResolvedValue({ _sum: { quantity: inCustody } });
    // @ts-expect-error mocked
    db.bookingAsset.aggregate.mockResolvedValue({
      _sum: { quantity: reservedElsewhere },
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: requestedElsewhere, fulfilledQuantity: 0 },
    });
    // A pool the guard would refuse against is a pool somebody has reserved;
    // the same number has to be visible to the lookup that decides whether
    // the model is worth measuring at all.
    stageReservedElsewhere(
      requestedElsewhere > 0 ? { [MODEL_ID]: requestedElsewhere } : {}
    );
  }

  /** Stages what OTHER bookings are still owed, per model. */
  function stageReservedElsewhere(outstandingByModel: Record<string, number>) {
    foreignRequestRows = Object.entries(outstandingByModel).map(
      ([assetModelId, quantity]) => ({
        assetModelId,
        quantity,
        fulfilledQuantity: 0,
      })
    );
  }

  /** Same, for reservations other bookings have partly or fully received. */
  function stageReservedElsewhereFulfilled(
    byModel: Record<string, { quantity: number; fulfilled: number }>
  ) {
    foreignRequestRows = Object.entries(byModel).map(
      ([assetModelId, { quantity, fulfilled }]) => ({
        assetModelId,
        quantity,
        fulfilledQuantity: fulfilled,
      })
    );
  }

  /** Stages this booking's own outstanding request for `MODEL_ID`. */
  function stageOwnRequest(quantity: number, fulfilledQuantity = 0) {
    ownRequestRows = [{ assetModelId: MODEL_ID, quantity, fulfilledQuantity }];
  }

  /** Stages units of `MODEL_ID` this booking already holds by name. */
  function stageHeldUnits(assetIds: string[], inCustodyIds: string[] = []) {
    // @ts-expect-error mocked
    db.asset.findMany.mockResolvedValue(
      assetIds.map((assetId) => ({
        id: assetId,
        assetModelId: MODEL_ID,
        custody: inCustodyIds.includes(assetId) ? [{ id: "custody-1" }] : [],
      }))
    );
  }

  function guard(
    assets: Array<{ id: string; title: string; assetModelId: string | null }>,
    {
      status = BookingStatus.RESERVED,
      window = { from, to },
      windowChanged = false,
    }: {
      status?: BookingStatus;
      window?: { from: Date | null; to: Date | null };
      windowChanged?: boolean;
    } = {}
  ) {
    return assertModelUnitsNotReservedElsewhere({
      assets,
      bookingId: BOOKING_ID,
      bookingStatus: status,
      windowChanged,
      organizationId: ORG_ID,
      from: window.from,
      to: window.to,
      // why: the mocked `db` stands in for the interactive transaction, the
      // same way `$transaction` hands the callback `db` in this file.
      tx: db as never,
    });
  }

  beforeEach(() => {
    vitest.clearAllMocks();
    // The org-scoped lock finds every model it is asked for.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.$queryRaw as any).mockResolvedValue([{ id: MODEL_ID }]);
    ownRequestRows = [];
    foreignRequestRows = [];
    // @ts-expect-error mocked
    db.bookingModelRequest.findMany.mockImplementation((args) =>
      Promise.resolve(
        // The foreign lookup excludes this booking; the own-request read
        // scopes to it.
        (args as { where?: { bookingId?: { not?: string } } })?.where?.bookingId
          ?.not
          ? foreignRequestRows
          : ownRequestRows
      )
    );
    // @ts-expect-error mocked
    db.asset.findMany.mockResolvedValue([]);
    // @ts-expect-error mocked
    db.assetModel.findMany.mockResolvedValue([
      { id: MODEL_ID, name: "Dell Latitude 5550" },
      { id: OTHER_MODEL_ID, name: "Arterial Puncture Simulator" },
    ]);
    stagePool({ total: 3 });
  });

  it("does nothing when the booking has no dates yet", async () => {
    expect.assertions(2);
    stagePool({ total: 3, requestedElsewhere: 3 });

    await guard([NEW_UNIT], { window: { from: null, to: null } });

    // Nothing to overlap, so no lock is taken and no pool is measured.
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.asset.count).not.toHaveBeenCalled();
  });

  it("ignores assets that have no model", async () => {
    expect.assertions(2);
    stagePool({ total: 3, requestedElsewhere: 3 });

    await guard([{ ...NEW_UNIT, assetModelId: null }]);

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.asset.count).not.toHaveBeenCalled();
  });

  it("locks every model, in sorted order, before measuring any pool", async () => {
    expect.assertions(3);
    // Both models are contested, so both are measured and the ordering the
    // lock loop guarantees is observable.
    stageReservedElsewhere({ "model-a": 1, "model-b": 1 });

    await guard([
      { id: "asset-b", title: "B", assetModelId: "model-b" },
      { id: "asset-a", title: "A", assetModelId: "model-a" },
    ]);

    const lockCalls = (db.$queryRaw as ReturnType<typeof vitest.fn>).mock.calls;
    // Values follow the template: [assetModelId, organizationId].
    expect(lockCalls.map((call) => call[1])).toEqual(["model-a", "model-b"]);
    expect(lockCalls.every((call) => call[2] === ORG_ID)).toBe(true);

    const lastLock = (db.$queryRaw as ReturnType<typeof vitest.fn>).mock
      .invocationCallOrder[1];
    const firstRead = (db.asset.count as ReturnType<typeof vitest.fn>).mock
      .invocationCallOrder[0];
    expect(lastLock).toBeLessThan(firstRead);
  });

  it("refuses a model that is not in the caller's workspace", async () => {
    expect.assertions(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.$queryRaw as any).mockResolvedValue([]);

    await expect(guard([NEW_UNIT])).rejects.toMatchObject({ status: 404 });
    expect(db.asset.count).not.toHaveBeenCalled();
  });

  it("refuses a unit when other bookings' model reservations leave none free", async () => {
    expect.assertions(4);
    // Three units, one in custody, two promised to other bookings by model.
    stagePool({ total: 3, inCustody: 1, requestedElsewhere: 2 });

    const error = await guard([NEW_UNIT]).catch((cause) => cause);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error).toMatchObject({ status: 400, shouldBeCaptured: false });
    expect(error.message).toContain(
      '"Dell Latitude 5550": 1 unit requested by name, but 2 units are reserved by model on other bookings for these dates and only 0 more can be booked.'
    );
    expect(db.bookingAsset.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bookingId: { not: BOOKING_ID } }),
      })
    );
  });

  it("names custody and units booked by name elsewhere when they shrink the pool", async () => {
    expect.assertions(2);
    // Three units: one in custody, one booked by name on another booking,
    // one reserved by model elsewhere. Nothing is free for this unit.
    stagePool({
      total: 3,
      inCustody: 1,
      reservedElsewhere: 1,
      requestedElsewhere: 1,
    });

    const error = await guard([NEW_UNIT]).catch((cause) => cause);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain(
      "only 0 more can be booked. 1 unit in custody and 1 unit booked by name on other bookings also count against the pool."
    );
  });

  it("allows a unit that fits beside the other bookings' reservations", async () => {
    expect.assertions(2);
    // Three units, one promised elsewhere: two are free.
    stagePool({ total: 3, requestedElsewhere: 1 });

    await expect(guard([NEW_UNIT])).resolves.toBeUndefined();
    // Model names are only read to build a refusal.
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
  });

  it("counts the units this booking already holds of the model with the new ones", async () => {
    expect.assertions(2);
    // Three units, two promised elsewhere: one is free. The booking already
    // holds one unit of the model, so a second one does not fit.
    stagePool({ total: 3, requestedElsewhere: 2 });
    stageHeldUnits(["asset-held"]);

    const error = await guard([NEW_UNIT]).catch((cause) => cause);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain(
      '"Dell Latitude 5550": 2 units requested by name'
    );
  });

  it("counts a unit already on the draft once when the reserve transition re-validates it", async () => {
    expect.assertions(2);
    stagePool({ total: 3, requestedElsewhere: 2 });
    stageHeldUnits([NEW_UNIT.id]);

    // One physical unit is one claim however many times it is named, and a
    // draft's whole footprint is measured because it holds nothing yet.
    await expect(
      guard([NEW_UNIT], { status: BookingStatus.DRAFT })
    ).resolves.toBeUndefined();
    expect(db.asset.count).toHaveBeenCalled();
  });

  it("never refuses an active booking a unit that fulfils its own request", async () => {
    expect.assertions(4);
    // The pool is already over-committed by other bookings, but this unit
    // answers a promise the booking already holds; it takes nothing new.
    stagePool({ total: 3, requestedElsewhere: 3 });
    stageOwnRequest(2);

    await expect(guard([NEW_UNIT])).resolves.toBeUndefined();
    expect(db.bookingModelRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingId: BOOKING_ID,
          fulfilledAt: null,
        }),
      })
    );
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.asset.count).not.toHaveBeenCalled();
  });

  it("measures the units an active booking adds beyond its own request", async () => {
    expect.assertions(2);
    // One unit still promised to this booking, two units added: the second
    // is a new claim, and the pool has one free unit for both of them.
    stagePool({ total: 3, requestedElsewhere: 2 });
    stageOwnRequest(1);

    const error = await guard([NEW_UNIT, SECOND_NEW_UNIT]).catch(
      (cause) => cause
    );

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain(
      '"Dell Latitude 5550": 2 units requested by name, but 2 units are reserved by model'
    );
  });

  it("leaves an active booking alone when nothing is added and the window is the same", async () => {
    expect.assertions(1);
    // The booking already names one unit and is promised one more; the pool
    // is over-committed, but this write adds nothing.
    stagePool({ total: 3, requestedElsewhere: 2 });
    stageOwnRequest(1);
    stageHeldUnits([NEW_UNIT.id]);

    await expect(guard([NEW_UNIT])).resolves.toBeUndefined();
  });

  it("measures the whole footprint again when an active booking's window changes", async () => {
    expect.assertions(2);
    // Same booking, extended into dates where the pool has one free unit for
    // the one it names and the one still promised to it.
    stagePool({ total: 3, requestedElsewhere: 2 });
    stageOwnRequest(1);
    stageHeldUnits([NEW_UNIT.id]);

    const error = await guard([NEW_UNIT], { windowChanged: true }).catch(
      (cause) => cause
    );

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain(
      '"Dell Latitude 5550": 1 unit requested by name and 1 unit still to assign from this booking\'s own reservation, but 2 units are reserved by model'
    );
  });

  it("makes a draft fit the units of its own request that stay unassigned", async () => {
    expect.assertions(2);
    // The draft promises itself two units and names one: it would need that
    // unit plus one more, and the pool has one free unit.
    stagePool({ total: 3, requestedElsewhere: 2 });
    stageOwnRequest(2);

    const error = await guard([NEW_UNIT], {
      status: BookingStatus.DRAFT,
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain(
      '"Dell Latitude 5550": 1 unit requested by name and 1 unit still to assign from this booking\'s own reservation, but 2 units are reserved by model'
    );
  });

  it("leaves a model alone that no other booking is owed units of", async () => {
    expect.assertions(3);
    // Three units, one of them in a custodian's hands, and the booking names
    // all three. Nobody has reserved the model, so nothing can be
    // over-committed by naming its units — and the custody deduction the pool
    // carries for display must not turn into a refusal here.
    stagePool({ total: 3, inCustody: 1, requestedElsewhere: 0 });

    await expect(
      guard([NEW_UNIT, SECOND_NEW_UNIT, { ...NEW_UNIT, id: "asset-new-3" }], {
        status: BookingStatus.DRAFT,
      })
    ).resolves.toBeUndefined();
    // Measuring it at all would be wasted work: this is the shape of every
    // write in a workspace that does not reserve by model.
    expect(db.asset.count).not.toHaveBeenCalled();
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
  });

  it("leaves a model alone once every reserved unit has been assigned", async () => {
    expect.assertions(2);
    stagePool({ total: 1, requestedElsewhere: 1 });
    // The other booking's reservation is fully delivered, so it is owed
    // nothing and competes for nothing.
    stageReservedElsewhereFulfilled({
      [MODEL_ID]: { quantity: 2, fulfilled: 2 },
    });

    await expect(
      guard([NEW_UNIT], { status: BookingStatus.DRAFT })
    ).resolves.toBeUndefined();
    expect(db.asset.count).not.toHaveBeenCalled();
  });

  it("does not charge a named unit that a custodian already holds", async () => {
    expect.assertions(2);
    // Three units, one in custody, two promised elsewhere. The booking holds
    // the in-custody unit and nothing else: the pool subtracted that unit
    // before this booking touched it, so its claim on the free units is zero.
    stagePool({ total: 3, inCustody: 1, requestedElsewhere: 2 });
    stageHeldUnits(["asset-held"], ["asset-held"]);

    await expect(
      guard([{ id: "asset-held", title: "Held", assetModelId: MODEL_ID }], {
        status: BookingStatus.DRAFT,
      })
    ).resolves.toBeUndefined();
    expect(db.asset.count).toHaveBeenCalled();
  });

  it("still refuses units beyond the ones a custodian holds", async () => {
    expect.assertions(2);
    // Same pool, but the booking also names a free unit — and there is none
    // left for it once the reservation is served.
    stagePool({ total: 3, inCustody: 1, requestedElsewhere: 2 });
    stageHeldUnits(["asset-held"], ["asset-held"]);

    const error = await guard([NEW_UNIT], {
      status: BookingStatus.DRAFT,
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain('"Dell Latitude 5550"');
  });

  it("reads the booking's own units without filtering out kit-driven rows", async () => {
    expect.assertions(1);
    stagePool({ total: 3, requestedElsewhere: 1 });

    await guard([NEW_UNIT]).catch(() => undefined);

    // A kit member is a physical unit off the same pool, and the pool read
    // counts it that way for every other booking. Scoping this read to
    // standalone rows is what would let a booking hold one through a kit and
    // name another on top.
    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingAssets: { some: { bookingId: BOOKING_ID } },
        }),
      })
    );
  });

  it("says nothing about model reservations when none is the reason", async () => {
    expect.assertions(2);
    // Contested by a reservation that is already fully delivered on paper but
    // still outstanding by a unit, so the model is measured; custody is what
    // closes the pool. The sentence must not claim zero units are reserved.
    stagePool({ total: 2, inCustody: 1, requestedElsewhere: 1 });
    stageReservedElsewhereFulfilled({
      [MODEL_ID]: { quantity: 1, fulfilled: 0 },
    });
    // @ts-expect-error mocked
    db.bookingModelRequest.aggregate.mockResolvedValue({
      _sum: { quantity: 1, fulfilledQuantity: 1 },
    });

    const error = await guard([NEW_UNIT, SECOND_NEW_UNIT], {
      status: BookingStatus.DRAFT,
    }).catch((cause) => cause);

    expect(error.message).not.toContain("0 units are reserved");
    expect(error.message).toContain("1 unit in custody also counts");
  });

  it("names every model that does not fit in one refusal", async () => {
    expect.assertions(3);
    stagePool({ total: 1, requestedElsewhere: 1 });
    stageReservedElsewhere({ [MODEL_ID]: 1, [OTHER_MODEL_ID]: 1 });

    const error = await guard([
      NEW_UNIT,
      { id: "asset-other", title: "Other", assetModelId: OTHER_MODEL_ID },
    ]).catch((cause) => cause);

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.message).toContain('"Dell Latitude 5550"');
    expect(error.message).toContain('"Arterial Puncture Simulator"');
  });
});
