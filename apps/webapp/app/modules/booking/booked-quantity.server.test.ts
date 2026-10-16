/**
 * Tests for the booked-quantity service: the guards every booked-amount edit
 * goes through (web adjust, mobile adjust, mobile re-add).
 *
 * @see {@link file://./booked-quantity.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { assertAssetQuantityAvailable } from "~/modules/asset/availability.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

import {
  assertBookedQuantitiesChangeable,
  noteBookedQuantityChanges,
  setStandaloneBookedQuantities,
  setStandaloneBookedQuantity,
  type BookedQuantityChange,
} from "./booked-quantity.server";

// @vitest-environment node

/** The transaction client the service is handed; reset per test. */
const tx = {
  bookingAsset: { findUnique: vi.fn(), update: vi.fn() },
};

// why: the database is the integration boundary. `$transaction` hands the
// service a recording client so reads and writes inside it are observable,
// and `db.bookingAsset.findUnique` backs the unlocked pre-check.
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi.fn(),
    bookingAsset: { findUnique: vi.fn() },
  },
}));

// why: the row lock is a raw `SELECT … FOR UPDATE`; only its order and
// arguments matter here.
vi.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vi.fn(),
}));

// why: the availability math has its own suite; here we assert which current
// quantity the service measures against, and that a refusal stops the write.
vi.mock("~/modules/asset/availability.server", () => ({
  assertAssetQuantityAvailable: vi.fn(),
}));

// why: note writes and the actor lookup are database writes and reads with
// their own coverage; we assert what is written and how often the actor is read.
vi.mock("~/modules/note/service.server", () => ({ createNotes: vi.fn() }));
vi.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vi.fn(),
}));
vi.mock("~/modules/user/service.server", () => ({ getUserByID: vi.fn() }));

// why: a failed note is logged, never thrown; the spy makes that observable
// without printing during the run.
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

const SCOPE = {
  bookingId: "booking-1",
  organizationId: "org-1",
  window: {
    from: new Date("2026-09-10T09:00:00.000Z"),
    to: new Date("2026-09-12T17:00:00.000Z"),
  },
};

/** A requested change of one standalone slice. */
function change(
  assetId: string,
  quantity: number,
  overrides: Partial<BookedQuantityChange> = {}
): BookedQuantityChange {
  return {
    bookingAssetId: `slice-${assetId}`,
    assetId,
    quantity,
    assetTitle: `Asset ${assetId}`,
    unitOfMeasure: "pcs",
    ...overrides,
  };
}

/** What the slice holds under the lock, keyed by its id. */
function slicesHold(
  rows: Record<string, { quantity: number; checkedOutAt?: Date | null } | null>
) {
  const read = ({ where }: { where: { id: string } }) => {
    const row = rows[where.id];
    return Promise.resolve(
      row
        ? { quantity: row.quantity, checkedOutAt: row.checkedOutAt ?? null }
        : null
    );
  };
  tx.bookingAsset.findUnique.mockImplementation(read);
  vi.mocked(db.bookingAsset.findUnique).mockImplementation(read as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.bookingAsset.findUnique.mockReset();
  tx.bookingAsset.update.mockReset().mockResolvedValue({});
  vi.mocked(db.$transaction).mockImplementation(((
    callback: (client: typeof tx) => unknown
  ) => callback(tx)) as never);
  vi.mocked(assertAssetQuantityAvailable).mockResolvedValue(undefined);
  vi.mocked(lockAssetForQuantityUpdate).mockResolvedValue(undefined as never);
});

describe("setStandaloneBookedQuantities", () => {
  it("writes the new amount and reports the one it replaced", async () => {
    slicesHold({ "slice-a": { quantity: 2 } });

    const applied = await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 5)],
    });

    expect(tx.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "slice-a" },
      data: { quantity: 5 },
    });
    expect(applied).toEqual([
      { assetId: "a", assetTitle: "Asset a", previousQuantity: 2, quantity: 5 },
    ]);
  });

  it("measures against the amount read under the lock, not a caller snapshot", async () => {
    slicesHold({ "slice-a": { quantity: 2 } });

    await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 6)],
    });

    expect(lockAssetForQuantityUpdate).toHaveBeenCalledWith(tx, "a", "org-1");
    expect(assertAssetQuantityAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "a",
        tx,
        window: SCOPE.window,
        excludeBookingId: "booking-1",
        currentQuantity: 2,
        requestedQuantity: 6,
      })
    );
  });

  it("writes nothing for an unchanged amount", async () => {
    slicesHold({ "slice-a": { quantity: 4 } });

    const applied = await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 4)],
    });

    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
    expect(applied[0]).toMatchObject({ previousQuantity: 4, quantity: 4 });
  });

  it("404s when the slice vanished before the lock", async () => {
    slicesHold({ "slice-a": null });

    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [change("a", 3)] })
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });

  it("refuses to change a slice whose units have been checked out", async () => {
    slicesHold({
      "slice-a": { quantity: 10, checkedOutAt: new Date("2026-09-10T10:00Z") },
    });

    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [change("a", 3)] })
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });

  it("lets an unchanged amount through on a checked-out slice", async () => {
    slicesHold({
      "slice-a": { quantity: 10, checkedOutAt: new Date("2026-09-10T10:00Z") },
    });

    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [change("a", 10)] })
    ).resolves.toHaveLength(1);
  });

  it("locks assets in id order, so overlapping requests cannot deadlock", async () => {
    slicesHold({ "slice-a": { quantity: 1 }, "slice-b": { quantity: 1 } });

    await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("b", 2), change("a", 2)],
    });

    expect(
      vi.mocked(lockAssetForQuantityUpdate).mock.calls.map((call) => call[1])
    ).toEqual(["a", "b"]);
  });

  it("applies the whole set in one transaction and stops at the first refusal", async () => {
    slicesHold({ "slice-a": { quantity: 1 }, "slice-b": { quantity: 1 } });
    vi.mocked(assertAssetQuantityAvailable).mockImplementation(
      ({ assetId }) => {
        if (assetId === "b") {
          return Promise.reject(
            new ShelfError({
              cause: null,
              message: "Only 1 unit available.",
              label: "Booking",
              status: 400,
              shouldBeCaptured: false,
            })
          );
        }
        return Promise.resolve();
      }
    );

    await expect(
      setStandaloneBookedQuantities({
        ...SCOPE,
        changes: [change("a", 2), change("b", 9)],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // b never reached its write; a's write rolls back with the transaction.
    expect(tx.bookingAsset.update).toHaveBeenCalledTimes(1);
  });

  it("opens no transaction for an empty set", async () => {
    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [] })
    ).resolves.toEqual([]);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("setStandaloneBookedQuantity", () => {
  it("returns the amount the slice held before", async () => {
    slicesHold({ "slice-a": { quantity: 3 } });

    await expect(
      setStandaloneBookedQuantity({ ...SCOPE, ...change("a", 7) })
    ).resolves.toEqual({ previousQuantity: 3 });
  });
});

describe("assertBookedQuantitiesChangeable", () => {
  it("checks without locking or writing", async () => {
    slicesHold({ "slice-a": { quantity: 2 } });

    await assertBookedQuantitiesChangeable({
      ...SCOPE,
      changes: [change("a", 5)],
    });

    expect(assertAssetQuantityAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: db,
        currentQuantity: 2,
        requestedQuantity: 5,
      })
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(lockAssetForQuantityUpdate).not.toHaveBeenCalled();
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });

  it("refuses a checked-out slice before anything is written", async () => {
    slicesHold({
      "slice-a": { quantity: 4, checkedOutAt: new Date("2026-09-10T10:00Z") },
    });

    await expect(
      assertBookedQuantitiesChangeable({ ...SCOPE, changes: [change("a", 1)] })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("noteBookedQuantityChanges", () => {
  beforeEach(() => {
    vi.mocked(getUserByID).mockResolvedValue({
      id: "user-1",
      firstName: "Sam",
      lastName: "Lee",
      displayName: "Sam",
    } as never);
    vi.mocked(createNotes).mockResolvedValue(undefined as never);
    vi.mocked(createSystemBookingNote).mockResolvedValue(undefined as never);
  });

  const base = {
    userId: "user-1",
    organizationId: "org-1",
    bookingId: "booking-1",
    bookingName: "Shoot",
  };

  it("reads the actor once and writes an asset note and a booking note per change", async () => {
    await noteBookedQuantityChanges({
      ...base,
      source: "web",
      changes: [
        { assetId: "a", assetTitle: "Cords", previousQuantity: 2, quantity: 5 },
        { assetId: "b", assetTitle: "Lamps", previousQuantity: 1, quantity: 3 },
      ],
    });

    expect(getUserByID).toHaveBeenCalledTimes(1);
    expect(createNotes).toHaveBeenCalledTimes(2);
    expect(createSystemBookingNote).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createNotes).mock.calls[0][0].content).not.toContain(
      "via mobile app"
    );
  });

  it("marks mobile changes and skips unchanged ones", async () => {
    await noteBookedQuantityChanges({
      ...base,
      source: "mobile",
      changes: [
        { assetId: "a", assetTitle: "Cords", previousQuantity: 2, quantity: 5 },
        { assetId: "b", assetTitle: "Lamps", previousQuantity: 3, quantity: 3 },
      ],
    });

    expect(createNotes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNotes).mock.calls[0][0]).toMatchObject({
      assetIds: ["a"],
    });
    expect(vi.mocked(createNotes).mock.calls[0][0].content).toContain(
      "from **2** to **5** via mobile app."
    );
  });

  it("writes nothing and reads no actor when nothing changed", async () => {
    await noteBookedQuantityChanges({
      ...base,
      source: "web",
      changes: [
        { assetId: "a", assetTitle: "Cords", previousQuantity: 2, quantity: 2 },
      ],
    });

    expect(getUserByID).not.toHaveBeenCalled();
    expect(createNotes).not.toHaveBeenCalled();
  });

  it("logs a failed note instead of throwing", async () => {
    vi.mocked(createNotes).mockRejectedValue(new Error("db down"));

    await expect(
      noteBookedQuantityChanges({
        ...base,
        source: "web",
        changes: [
          {
            assetId: "a",
            assetTitle: "Cords",
            previousQuantity: 2,
            quantity: 5,
          },
        ],
      })
    ).resolves.toBeUndefined();
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });
});
