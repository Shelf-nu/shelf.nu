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
    expect.assertions(2);
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

    // Parse it exactly as the feed does: the only tag may be the actor link
    // we emit ourselves...
    const tags = markdocTagsIn(content);
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

      const tags = markdocTagsIn(content);
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
      // Row and event share one `new Date()` — the audit trail and the column
      // must not disagree, even by a few milliseconds.
      const writtenAt = (
        db.bookingModelRequest.update as ReturnType<typeof vitest.fn>
      ).mock.calls[0]?.[0]?.data?.fulfilledAt as Date;
      expect(changes[0].toValue).toBe(writtenAt.toISOString());
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
    expect.assertions(2);
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

    const tags = markdocTagsIn(content);
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
