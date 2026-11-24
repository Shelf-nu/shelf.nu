/**
 * Tests for the booked-quantity service: the guards every booked-amount edit
 * goes through (web adjust, mobile adjust, mobile re-add).
 *
 * @see {@link file://./booked-quantity.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { URL_SHAPED_VALUE, expectValueOnlyInTag } from "@helpers/note-tags";

import { db } from "~/database/db.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { assertAssetQuantityAvailable } from "~/modules/asset/availability.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

import {
  formatSourcesForNote,
  noteBookedQuantityChanges,
  setStandaloneBookedQuantities,
  setStandaloneBookedQuantitiesWithinTx,
  setStandaloneBookedQuantity,
  type BookedQuantityChange,
} from "./booked-quantity.server";
import {
  resizeSlices,
  setAutoSources,
  setManualSources,
} from "./sources/booking-sources.server";

// @vitest-environment node

/** The transaction client the service is handed; reset per test. */
const tx = {
  // The booking row lock (`SELECT status ... FOR UPDATE`).
  $queryRaw: vi.fn(),
  bookingAsset: { findUnique: vi.fn(), update: vi.fn() },
  bookingAssetSource: { findMany: vi.fn() },
  location: { findMany: vi.fn() },
};

// why: the database is the integration boundary. `$transaction` hands the
// service a recording client so reads and writes inside it are observable.
vi.mock("~/database/db.server", () => ({
  db: { $transaction: vi.fn() },
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

// why: the event write is a database insert with its own suite; we assert the
// payload and that it runs on the same transaction client as the change.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
}));

// why: the sources facade (locks, conversion, allocation, admission) has its
// own suite; here we assert when it is called, with what, and in which order
// against the quantity write.
vi.mock("./sources/booking-sources.server", () => ({
  resizeSlices: vi.fn(),
  setManualSources: vi.fn(),
  setAutoSources: vi.fn(),
}));

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

/** A slice as the locked re-read returns it. */
type HeldSlice = {
  quantity: number;
  checkedOutAt?: Date | null;
  sourceAllocation?: "LEGACY" | "KIT" | "AUTO" | "MANUAL";
};

/** What the slice holds under the lock, keyed by its id. */
function slicesHold(rows: Record<string, HeldSlice | null>) {
  const read = ({ where }: { where: { id: string } }) => {
    const row = rows[where.id];
    return Promise.resolve(
      row
        ? {
            quantity: row.quantity,
            checkedOutAt: row.checkedOutAt ?? null,
            sourceAllocation: row.sourceAllocation ?? "LEGACY",
          }
        : null
    );
  };
  tx.bookingAsset.findUnique.mockImplementation(read);
}

/** The status the booking lock reads. */
function bookingIs(status: string) {
  tx.$queryRaw.mockResolvedValue([{ status }]);
}

/** A source row as the service reads it. */
function row(
  kind: "LOCATION" | "UNPLACED" | "UNKNOWN" | "UNASSIGNED",
  locationId: string | null,
  counts: { quantity: number; out?: number; released?: number }
) {
  return {
    kind,
    locationId,
    quantity: counts.quantity,
    outQuantity: counts.out ?? 0,
    releasedQuantity: counts.released ?? 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.bookingAsset.findUnique.mockReset();
  tx.bookingAsset.update.mockReset().mockResolvedValue({});
  tx.bookingAssetSource.findMany.mockReset().mockResolvedValue([]);
  tx.location.findMany.mockReset().mockResolvedValue([]);
  tx.$queryRaw.mockReset();
  bookingIs("RESERVED");
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
    // Every guard runs before the first write, so nothing was written.
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
    expect(resizeSlices).not.toHaveBeenCalled();
  });

  it("opens no transaction for an empty set", async () => {
    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [] })
    ).resolves.toEqual([]);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("setStandaloneBookedQuantitiesWithinTx", () => {
  it("writes inside the caller's transaction instead of opening one", async () => {
    slicesHold({ "slice-a": { quantity: 2 } });

    await setStandaloneBookedQuantitiesWithinTx(tx as never, {
      ...SCOPE,
      changes: [change("a", 5)],
    });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(lockAssetForQuantityUpdate).toHaveBeenCalledWith(tx, "a", "org-1");
    expect(tx.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "slice-a" },
      data: { quantity: 5 },
    });
  });
});

describe("setStandaloneBookedQuantity", () => {
  it("returns the amount the slice held before", async () => {
    slicesHold({ "slice-a": { quantity: 3 } });

    await expect(
      setStandaloneBookedQuantity({ ...SCOPE, ...change("a", 7) })
    ).resolves.toEqual({ previousQuantity: 3, sourcesChanged: false });
  });
});

describe("pool source rows", () => {
  it("resizes the source rows before writing the new quantity", async () => {
    slicesHold({ "slice-a": { quantity: 2, sourceAllocation: "AUTO" } });

    await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 5)],
    });

    expect(resizeSlices).toHaveBeenCalledWith(tx, {
      organizationId: "org-1",
      bookingId: "booking-1",
      changes: [{ sliceId: "slice-a", quantity: 5 }],
      window: SCOPE.window,
      admit: true,
    });
    expect(vi.mocked(resizeSlices).mock.invocationCallOrder[0]).toBeLessThan(
      tx.bookingAsset.update.mock.invocationCallOrder[0]
    );
  });

  it("locks the booking before the asset", async () => {
    slicesHold({ "slice-a": { quantity: 2 } });

    await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 5)],
    });

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(lockAssetForQuantityUpdate).mock.invocationCallOrder[0]
    );
  });

  it("skips the facade when no quantity changes", async () => {
    slicesHold({ "slice-a": { quantity: 4, sourceAllocation: "AUTO" } });

    await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 4)],
    });

    expect(resizeSlices).not.toHaveBeenCalled();
  });

  it("writes nothing when the facade refuses the resize", async () => {
    slicesHold({ "slice-a": { quantity: 2, sourceAllocation: "AUTO" } });
    vi.mocked(resizeSlices).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "Not enough free at Demo Warehouse.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [change("a", 9)] })
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });
});

describe("checked-out slices", () => {
  const OUT_AT = new Date("2026-09-10T10:00Z");

  it("lets a pool slice on an ONGOING booking gain pending units", async () => {
    bookingIs("ONGOING");
    slicesHold({
      "slice-a": {
        quantity: 10,
        checkedOutAt: OUT_AT,
        sourceAllocation: "AUTO",
      },
    });

    await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 12)],
    });

    expect(resizeSlices).toHaveBeenCalledTimes(1);
    expect(tx.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "slice-a" },
      data: { quantity: 12 },
    });
  });

  it("lets a pool slice on an OVERDUE booking drop pending units only", async () => {
    bookingIs("OVERDUE");
    slicesHold({
      "slice-a": {
        quantity: 10,
        checkedOutAt: OUT_AT,
        sourceAllocation: "MANUAL",
      },
    });
    // 6 out, 1 returned, 3 pending: the floor is 7.
    tx.bookingAssetSource.findMany.mockResolvedValue([
      row("LOCATION", "loc-1", { quantity: 8, out: 5, released: 1 }),
      row("UNPLACED", null, { quantity: 2, out: 1 }),
    ]);

    await setStandaloneBookedQuantities({
      ...SCOPE,
      changes: [change("a", 7)],
    });
    expect(tx.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "slice-a" },
      data: { quantity: 7 },
    });
  });

  it("refuses to drop units that are out or already returned", async () => {
    bookingIs("ONGOING");
    slicesHold({
      "slice-a": {
        quantity: 10,
        checkedOutAt: OUT_AT,
        sourceAllocation: "AUTO",
      },
    });
    tx.bookingAssetSource.findMany.mockResolvedValue([
      row("LOCATION", "loc-1", { quantity: 8, out: 5, released: 1 }),
      row("UNPLACED", null, { quantity: 2, out: 1 }),
    ]);

    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [change("a", 6)] })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("cannot go below 7"),
    });
    expect(resizeSlices).not.toHaveBeenCalled();
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });

  it("keeps refusing a LEGACY slice on an ONGOING booking", async () => {
    bookingIs("ONGOING");
    slicesHold({
      "slice-a": {
        quantity: 10,
        checkedOutAt: OUT_AT,
        sourceAllocation: "LEGACY",
      },
    });

    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [change("a", 12)] })
    ).rejects.toMatchObject({ status: 400, title: "Already checked out" });
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
  });

  it("refuses a pool slice whose booking is no longer ONGOING or OVERDUE", async () => {
    bookingIs("COMPLETE");
    slicesHold({
      "slice-a": {
        quantity: 10,
        checkedOutAt: OUT_AT,
        sourceAllocation: "AUTO",
      },
    });

    await expect(
      setStandaloneBookedQuantities({ ...SCOPE, changes: [change("a", 12)] })
    ).rejects.toMatchObject({ status: 400 });
    expect(resizeSlices).not.toHaveBeenCalled();
  });
});

describe("setStandaloneBookedQuantity with sources", () => {
  const MANUAL = {
    mode: "MANUAL" as const,
    sources: [
      { locationId: "loc-1", quantity: 8 },
      { locationId: null, quantity: 7 },
    ],
  };

  beforeEach(() => {
    vi.mocked(getUserByID).mockResolvedValue({
      id: "user-1",
      firstName: "Sam",
      lastName: "Lee",
      displayName: "Sam",
    } as never);
    tx.location.findMany.mockResolvedValue([
      { id: "loc-1", name: "Demo Warehouse" },
    ]);
  });

  /** The slice's rows before and after the facade call, and its mode. */
  function sourcesMoveFrom(
    before: ReturnType<typeof row>[],
    after: ReturnType<typeof row>[],
    modes: { before: string; after: string }
  ) {
    tx.bookingAssetSource.findMany
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    tx.bookingAsset.findUnique.mockImplementation(
      ({ select }: { select: Record<string, boolean> }) => {
        if (select.quantity) {
          return Promise.resolve({
            quantity: 15,
            checkedOutAt: null,
            sourceAllocation: modes.before,
          });
        }
        // The mode is read once before the rows are first read, once after.
        const mode =
          tx.bookingAssetSource.findMany.mock.calls.length === 0
            ? modes.before
            : modes.after;
        return Promise.resolve({ sourceAllocation: mode });
      }
    );
  }

  it("sets MANUAL sources and writes a note and an event on the same transaction", async () => {
    sourcesMoveFrom(
      [row("UNPLACED", null, { quantity: 15 })],
      [
        row("LOCATION", "loc-1", { quantity: 8 }),
        row("UNPLACED", null, { quantity: 7 }),
      ],
      { before: "AUTO", after: "MANUAL" }
    );

    const result = await setStandaloneBookedQuantity({
      ...SCOPE,
      ...change("a", 15),
      sources: { input: MANUAL, userId: "user-1" },
    });

    expect(result).toEqual({ previousQuantity: 15, sourcesChanged: true });
    expect(setManualSources).toHaveBeenCalledWith(tx, {
      organizationId: "org-1",
      bookingId: "booking-1",
      sliceId: "slice-a",
      sources: MANUAL.sources,
      window: SCOPE.window,
    });
    expect(createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-1",
        organizationId: "org-1",
        content: expect.stringContaining(
          'changed where units come from for {% link to="/assets/a" text="Asset a" /%}: Demo Warehouse 8, Unplaced 7.'
        ),
      }),
      tx
    );
    expect(recordEvent).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "BOOKING_ASSET_SOURCES_CHANGED",
        entityType: "BOOKING",
        entityId: "booking-1",
        bookingId: "booking-1",
        assetId: "a",
        field: "sources",
        fromValue: [{ kind: "UNPLACED", locationId: null, planned: 15 }],
        toValue: [
          { kind: "LOCATION", locationId: "loc-1", planned: 8 },
          { kind: "UNPLACED", locationId: null, planned: 7 },
        ],
        meta: { sliceId: "slice-a", mode: "MANUAL" },
      },
      tx
    );
  });

  it("returns the slice to AUTO and says so in the note", async () => {
    sourcesMoveFrom(
      [
        row("LOCATION", "loc-1", { quantity: 8 }),
        row("UNPLACED", null, { quantity: 7 }),
      ],
      [row("UNPLACED", null, { quantity: 15 })],
      { before: "MANUAL", after: "AUTO" }
    );

    await setStandaloneBookedQuantity({
      ...SCOPE,
      ...change("a", 15),
      sources: { input: { mode: "AUTO" }, userId: "user-1" },
    });

    expect(setAutoSources).toHaveBeenCalledWith(tx, {
      organizationId: "org-1",
      bookingId: "booking-1",
      sliceId: "slice-a",
      window: SCOPE.window,
    });
    expect(
      vi.mocked(createSystemBookingNote).mock.calls[0][0].content
    ).toContain("Unplaced 15 (chosen automatically).");
  });

  it("writes no note or event when nothing moved", async () => {
    const same = [row("UNPLACED", null, { quantity: 15 })];
    sourcesMoveFrom(same, same, { before: "AUTO", after: "AUTO" });

    const result = await setStandaloneBookedQuantity({
      ...SCOPE,
      ...change("a", 15),
      sources: { input: { mode: "AUTO" }, userId: "user-1" },
    });

    expect(result.sourcesChanged).toBe(false);
    expect(createSystemBookingNote).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("resizes without admitting, before setting the sources", async () => {
    sourcesMoveFrom(
      [row("UNPLACED", null, { quantity: 15 })],
      [
        row("LOCATION", "loc-1", { quantity: 8 }),
        row("UNPLACED", null, { quantity: 7 }),
      ],
      { before: "AUTO", after: "MANUAL" }
    );
    tx.bookingAsset.findUnique.mockImplementationOnce(() =>
      Promise.resolve({
        quantity: 10,
        checkedOutAt: null,
        sourceAllocation: "AUTO",
      })
    );

    await setStandaloneBookedQuantity({
      ...SCOPE,
      ...change("a", 15),
      sources: { input: MANUAL, userId: "user-1" },
    });

    expect(vi.mocked(resizeSlices).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(setManualSources).mock.invocationCallOrder[0]
    );
    // The resize admits nothing; setManualSources admits the combined result.
    expect(resizeSlices).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ admit: false })
    );
  });

  it("refuses a sources change on a closed booking and touches nothing", async () => {
    bookingIs("CANCELLED");
    slicesHold({ "slice-a": { quantity: 15, sourceAllocation: "AUTO" } });

    await expect(
      setStandaloneBookedQuantity({
        ...SCOPE,
        ...change("a", 15),
        sources: { input: MANUAL, userId: "user-1" },
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(lockAssetForQuantityUpdate).not.toHaveBeenCalled();
    expect(setManualSources).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("passes a facade refusal through and writes no note or event", async () => {
    slicesHold({ "slice-a": { quantity: 15, sourceAllocation: "AUTO" } });
    vi.mocked(setManualSources).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "One of the chosen locations does not hold this asset.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    await expect(
      setStandaloneBookedQuantity({
        ...SCOPE,
        ...change("a", 15),
        sources: { input: MANUAL, userId: "user-1" },
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(createSystemBookingNote).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });
});

describe("formatSourcesForNote", () => {
  it("strips Markdoc delimiters from location names", () => {
    expect(
      formatSourcesForNote([
        {
          key: "LOCATION:loc-1",
          kind: "LOCATION",
          locationId: "loc-1",
          label: "Shelf {% a %}",
          planned: 3,
          out: 0,
          short: false,
        },
      ])
    ).not.toContain("{%");
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

  it("links a URL-shaped asset title in the booking note, never as bare text", async () => {
    await noteBookedQuantityChanges({
      ...base,
      source: "web",
      changes: [
        {
          assetId: "a",
          assetTitle: URL_SHAPED_VALUE,
          previousQuantity: 2,
          quantity: 5,
        },
      ],
    });

    const { content } = vi.mocked(createSystemBookingNote).mock.calls[0][0];
    expectValueOnlyInTag(content, URL_SHAPED_VALUE, ["link"]);
    expect(content).toContain(
      `{% link to="/assets/a" text="${URL_SHAPED_VALUE}" /%}`
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
