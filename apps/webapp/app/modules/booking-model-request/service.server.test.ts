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
  getAssetModelAvailability,
  materializeModelRequestForAsset,
  removeBookingModelRequest,
  upsertBookingModelRequest,
} from "./service.server";

vitest.mock("~/database/db.server", () => ({
  db: {
    // why: the service calls the callback form of $transaction; route it
    // through the same mocked `db` so per-test overrides are visible
    // inside the tx callback.
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
    },
    booking: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    bookingAsset: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    bookingModelRequest: {
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

const BOOKING_ID = "booking-1";
const ORG_ID = "org-1";
const USER_ID = "user-1";
const MODEL_ID = "model-1";

const from = new Date("2026-05-01T09:00:00Z");
const to = new Date("2026-05-05T18:00:00Z");

describe("getAssetModelAvailability", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
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

    expect(result).toEqual({
      matched: true,
      remaining: 2,
      modelName: "Dell Latitude 5550",
    });
    // Update writes fulfilledQuantity: 1 (one unit scanned). fulfilledAt
    // stays absent from the payload because we haven't caught up to
    // quantity yet — the row is still outstanding.
    expect(db.bookingModelRequest.update).toHaveBeenCalledWith({
      where: {
        bookingId_assetModelId: {
          bookingId: BOOKING_ID,
          assetModelId: MODEL_ID,
        },
      },
      data: { fulfilledQuantity: 1 },
    });
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
      remaining: 0,
      modelName: "Dell Latitude 5550",
    });
    // Update payload must include BOTH the incremented fulfilledQuantity
    // AND a fulfilledAt timestamp — this is the scan that completes the
    // reservation, so the row becomes historical.
    const updateCall = (
      db.bookingModelRequest.update as ReturnType<typeof vitest.fn>
    ).mock.calls[0]?.[0];
    expect(updateCall?.data?.fulfilledQuantity).toBe(1);
    expect(updateCall?.data?.fulfilledAt).toBeInstanceOf(Date);
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
});
