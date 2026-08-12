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
import { AssetType, BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
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
  (db.$queryRaw as any).mockImplementation(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db.bookingModelRequest.findUnique as any)();
    if (!row) return [];
    if (row.fulfilledQuantity >= row.quantity) return [];
    row.fulfilledQuantity += 1;
    if (row.fulfilledQuantity >= row.quantity) row.fulfilledAt = new Date();
    return [
      { fulfilledQuantity: row.fulfilledQuantity, quantity: row.quantity },
    ];
  });
}

const BOOKING_ID = "booking-1";
const ORG_ID = "org-1";
const USER_ID = "user-1";
const MODEL_ID = "model-1";

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
    const sql = ((vitest.mocked(db.$queryRaw).mock.calls[0]?.[0] as unknown as string[]) ?? []).join("?");
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
    const sql =
      ((vitest.mocked(db.$queryRaw).mock.calls[0]?.[0] as unknown as string[]) ?? []).join("?");
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
      tx,
    });

    expect(result).toEqual({ matched: false });
    expect(db.bookingModelRequest.update).not.toHaveBeenCalled();
    expect(db.bookingModelRequest.delete).not.toHaveBeenCalled();
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

/**
 * Note volume on bulk fulfilment.
 *
 * The countdown wording was designed for the scanner, which discharges one unit
 * at a time. Routing "Manage assets" through the same helper made bulk
 * fulfilment reachable — tick 20 matching assets, save once — and the per-asset
 * note turned that into 20 near-identical lines counting down, all INSERTed
 * inside the caller's interactive transaction.
 */
describe("fulfilModelRequestsForAssets — note volume", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = db as any;

  beforeEach(() => {
    vitest.clearAllMocks();
    installClaimSimulator();
  });

  const stageRequest = (quantity: number) => {
    const row = {
      id: "req-1",
      bookingId: BOOKING_ID,
      assetModelId: MODEL_ID,
      quantity,
      fulfilledQuantity: 0,
      fulfilledAt: null as Date | null,
      assetModel: { name: "Dell Latitude 5550" },
    };
    // why: every simulated claim must read and mutate the SAME row, so the
    // loop's next read sees the previous increment — that is what a committed
    // row does, and returning a fresh object each call would hide a lost
    // update instead of exposing it.
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockImplementation(() =>
      Promise.resolve(row)
    );
    return row;
  };

  const assetsOfModel = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `asset-${i + 1}`,
      title: `Laptop #${i + 1}`,
      assetModelId: MODEL_ID,
      type: AssetType.INDIVIDUAL,
    }));

  it("writes ONE note for a batch, not one per asset", async () => {
    expect.assertions(2);
    stageRequest(20);

    await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: assetsOfModel(20),
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    expect(db.bookingNote.create).toHaveBeenCalledTimes(1);

    // States the FINAL remainder, not a mid-batch countdown.
    const content = vitest.mocked(db.bookingNote.create).mock.calls[0][0].data
      .content as string;
    expect(content).toContain("0 × Dell Latitude 5550 remaining");
  });

  it("states a count instead of embedding ids once the batch is large", async () => {
    expect.assertions(2);
    stageRequest(40);

    await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: assetsOfModel(40),
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    const content = vitest.mocked(db.bookingNote.create).mock.calls[0][0].data
      .content as string;

    // `assets_list` copies every id into the query string of GET /api/assets,
    // so an unbounded batch of 25-char CUIDs exceeds Node's request-target
    // limit and the activity entry answers 431 instead of opening.
    expect(content).not.toContain("assets_list");
    expect(content).toContain("**40 assets**");
  });

  it("keeps the single-asset wording byte-identical to the per-asset note", async () => {
    expect.assertions(1);
    stageRequest(3);

    await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: assetsOfModel(1),
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    // `wrapAssetsWithDataForNote` emits the same `{% link %}` tag at count 1
    // that `wrapLinkForNote` produced, so the scanner feed is unchanged.
    const content = vitest.mocked(db.bookingNote.create).mock.calls[0][0].data
      .content as string;
    expect(content).toContain(
      '{% link to="/assets/asset-1" text="Laptop #1" /%}'
    );
  });

  it("writes no note when nothing was claimed", async () => {
    expect.assertions(1);
    // why: findUnique default is null — no reservation exists for this model.
    // @ts-expect-error mocked
    db.bookingModelRequest.findUnique.mockResolvedValue(null);

    await fulfilModelRequestsForAssets({
      bookingId: BOOKING_ID,
      assets: assetsOfModel(5),
      organizationId: ORG_ID,
      userId: USER_ID,
      tx,
    });

    expect(db.bookingNote.create).not.toHaveBeenCalled();
  });
});
