/**
 * The wiring behind the printed check-in receipt.
 *
 * The reconciliation rules have their own tests next door, on a pure function
 * with no database. What is covered here is everything between the queries and
 * that function: which columns are asked for, how the marker rows, the
 * disposition logs and the completion event are joined onto the printed rows,
 * and which names come back on them.
 *
 * That seam is worth its own suite because nothing else can see it. A green
 * unit suite and a clean typecheck say nothing about whether this helper runs:
 * the pure module can be entirely correct while the server helper throws on its
 * first line.
 *
 * @see {@link file://./checkin-receipt.server.ts}
 * @see {@link file://./checkin-receipt.test.ts}
 */
// @vitest-environment node

// why: external database — don't hit the real DB.
vi.mock("~/database/db.server", () => ({
  db: {
    bookingAsset: { findMany: vi.fn() },
    consumptionLog: { findMany: vi.fn() },
    partialBookingCheckin: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

// why: the shared PDF read is a large org-scoped query with its own tests
// (`pdf-helpers.test.ts`). This suite only cares that its rows arrive and are
// joined to the markers, so the rows are supplied directly.
vi.mock("./pdf-helpers", () => ({
  fetchAllPdfRelatedData: vi.fn(),
}));

// why: the canonical check-in moment is one `ActivityEvent` lookup with its own
// contract; stubbing it lets a case say "this booking has an event" or "it has
// none" without writing activity rows.
vi.mock("~/modules/reports/check-in-time.server", () => ({
  resolveCheckInTimes: vi.fn(),
}));

// why: importing the booking service for one pure function pulls the whole
// module. The stub is the exact-attribution half of the real primitive, which
// is all these cases use: every log here names its slice. The greedy pass for
// untagged logs is covered in `service.server.test.ts`, and the receipt never
// hands it a moment anyway.
vi.mock("./service.server", () => ({
  attributeCategorizedDispositionsByBookingAsset: ({
    bookingAssetRows,
    consumptionLogs,
  }: {
    bookingAssetRows: Array<{ id: string }>;
    consumptionLogs: Array<{
      bookingAssetId: string | null;
      category: "RETURN" | "CONSUME" | "LOSS" | "DAMAGE";
      quantity: number;
    }>;
  }) => {
    const field = {
      RETURN: "returned",
      CONSUME: "consumed",
      LOSS: "lost",
      DAMAGE: "damaged",
    } as const;
    const out = new Map(
      bookingAssetRows.map((row) => [
        row.id,
        { returned: 0, consumed: 0, lost: 0, damaged: 0 },
      ])
    );
    for (const log of consumptionLogs) {
      if (!log.bookingAssetId) continue;
      const row = out.get(log.bookingAssetId);
      if (row) row[field[log.category]] += log.quantity;
    }
    return out;
  },
}));

import { AssetType, BookingStatus } from "@prisma/client";

import { db } from "~/database/db.server";
import { resolveCheckInTimes } from "~/modules/reports/check-in-time.server";

import { fetchCheckinReceiptData } from "./checkin-receipt.server";
import type { PdfDbResult } from "./pdf-helpers";
import { fetchAllPdfRelatedData } from "./pdf-helpers";

const mockOf = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CHECKED_OUT_AT = new Date("2026-09-01T09:00:00.000Z");
const CHECKED_IN_AT = new Date("2026-09-03T17:30:00.000Z");
const COMPLETED_AT = new Date("2026-09-03T17:31:00.000Z");
const LOGGED_AT = new Date("2026-09-02T11:00:00.000Z");
const WRITTEN_OFF_AT = new Date("2026-09-02T15:00:00.000Z");

/** One printed row as the shared PDF read hands it over. */
function pdfRow(bookingAssetId: string, assetId: string, title: string) {
  return {
    id: assetId,
    bookingAssetId,
    title,
    quantity: 1,
    kit: null,
    isRemovedFromKit: false,
  };
}

/**
 * The shared PDF read's result.
 *
 * Cast through `unknown` rather than spelled out: the real shape is a full
 * Prisma `Asset` per row plus the whole booking, and none of the ~40 columns
 * this helper never reads would make the test say more. The cast is named as
 * `PdfDbResult` so a change to the fields it DOES read still has to compile.
 */
function pdfResultWith(
  rows: ReturnType<typeof pdfRow>[],
  status: BookingStatus
): PdfDbResult {
  return {
    booking: {
      id: "booking-1",
      name: "Shoot",
      status,
      description: null,
      from: new Date("2026-09-01T08:00:00.000Z"),
      to: new Date("2026-09-04T18:00:00.000Z"),
      originalFrom: new Date("2026-09-01T08:00:00.000Z"),
      originalTo: new Date("2026-09-04T18:00:00.000Z"),
      custodianUser: null,
      custodianTeamMember: { name: "Ada" },
      tags: [],
    },
    organization: {
      id: "org-1",
      name: "Org",
      imageId: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    assets: rows,
    assetIdToDisplayCodeMap: {},
  } as unknown as PdfDbResult;
}

/** Runs the helper with the ordinary arguments; only the stubs vary per case. */
function run() {
  return fetchCheckinReceiptData(
    "booking-1",
    "org-1",
    "user-1",
    undefined,
    new Request("http://localhost/test")
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOf(db.partialBookingCheckin.findMany).mockResolvedValue([]);
  mockOf(db.consumptionLog.findMany).mockResolvedValue([]);
  mockOf(resolveCheckInTimes).mockResolvedValue(new Map());
});

describe("fetchCheckinReceiptData", () => {
  it("reconciles a finished booking from its slice markers", async () => {
    mockOf(fetchAllPdfRelatedData).mockResolvedValue(
      pdfResultWith(
        [
          pdfRow("ba-1", "asset-1", "Tripod"),
          pdfRow("ba-2", "asset-2", "Monitor"),
        ],
        BookingStatus.COMPLETE
      )
    );
    mockOf(db.bookingAsset.findMany).mockResolvedValue(
      ["ba-1", "ba-2"].map((id, index) => ({
        id,
        assetId: `asset-${index + 1}`,
        quantity: 1,
        assetKitId: null,
        checkedOutAt: CHECKED_OUT_AT,
        checkedOutById: "user-1",
        checkedOutQuantity: 0,
        checkedInAt: CHECKED_IN_AT,
        checkedInById: "user-1",
        asset: { type: AssetType.INDIVIDUAL },
      }))
    );
    mockOf(resolveCheckInTimes).mockResolvedValue(
      new Map([["booking-1", COMPLETED_AT]])
    );
    mockOf(db.user.findMany).mockResolvedValue([
      {
        id: "user-1",
        displayName: "Ada Lovelace",
        firstName: null,
        lastName: null,
      },
    ]);

    const receipt = await run();

    expect(receipt.rows.map((row) => row.state)).toEqual([
      "RETURNED",
      "RETURNED",
    ]);
    expect(receipt.stamp).toBe("All items returned");
    // The recorded completion event, not the marker and never `updatedAt`.
    expect(receipt.returnedAt).toEqual(COMPLETED_AT);
    expect(receipt.checkedInByNames).toEqual(["Ada Lovelace"]);
    expect(receipt.rows[0].checkedInByName).toBe("Ada Lovelace");
    expect(receipt.rows[0].title).toBe("Tripod");
  });

  it("dates a partly returned quantity slice from the log that recorded it", async () => {
    mockOf(fetchAllPdfRelatedData).mockResolvedValue(
      pdfResultWith(
        [pdfRow("ba-1", "asset-1", "XLR cable")],
        BookingStatus.ONGOING
      )
    );
    mockOf(db.bookingAsset.findMany).mockResolvedValue([
      {
        id: "ba-1",
        assetId: "asset-1",
        quantity: 6,
        assetKitId: null,
        checkedOutAt: CHECKED_OUT_AT,
        checkedOutById: "user-1",
        checkedOutQuantity: 6,
        // Null on purpose: the marker means fully reconciled, and three of six
        // units are still out.
        checkedInAt: null,
        checkedInById: null,
        asset: { type: AssetType.QUANTITY_TRACKED },
      },
    ]);
    mockOf(db.consumptionLog.findMany).mockResolvedValue([
      {
        assetId: "asset-1",
        bookingAssetId: "ba-1",
        category: "RETURN",
        quantity: 3,
        createdAt: LOGGED_AT,
        userId: "user-7",
      },
      // Later, and by someone else: a write-off is not a hand-over, so it must
      // neither date the row nor name a receiver.
      {
        assetId: "asset-1",
        bookingAssetId: "ba-1",
        category: "DAMAGE",
        quantity: 1,
        createdAt: WRITTEN_OFF_AT,
        userId: "user-9",
      },
    ]);
    mockOf(db.user.findMany).mockResolvedValue([
      {
        id: "user-1",
        displayName: "Ada Lovelace",
        firstName: null,
        lastName: null,
      },
      {
        id: "user-7",
        displayName: "Grace Hopper",
        firstName: null,
        lastName: null,
      },
    ]);

    const receipt = await run();

    const row = receipt.rows[0];
    expect(row.state).toBe("STILL_OUT");
    expect(row.returned).toBe(3);
    expect(row.damaged).toBe(1);
    expect(row.stillOut).toBe(2);
    // Without the log this row prints its returned units with no date and no
    // name against them.
    expect(row.checkedInAt).toEqual(LOGGED_AT);
    // The returner, at the moment of the return — never the later write-off.
    expect(row.checkedInByName).toBe("Grace Hopper");
    expect(receipt.stamp).toBe("Partial return · 2 still out");
    // No completion event on a live booking, so the summary falls back to what
    // the rows carry.
    expect(receipt.returnedAt).toEqual(LOGGED_AT);
    expect(receipt.checkedInByNames).toEqual(["Grace Hopper"]);
  });

  it("dates a mobile partial return, whose log names no slice", async () => {
    // The phone submits quantity dispositions without a slice id, so its logs
    // are ordinary current data rather than legacy residue. This asset has one
    // slice on the booking, so the log can only describe that slice and its
    // moment is a record rather than a choice.
    mockOf(fetchAllPdfRelatedData).mockResolvedValue(
      pdfResultWith(
        [pdfRow("ba-1", "asset-1", "XLR cable")],
        BookingStatus.ONGOING
      )
    );
    mockOf(db.bookingAsset.findMany).mockResolvedValue([
      {
        id: "ba-1",
        assetId: "asset-1",
        quantity: 6,
        assetKitId: null,
        checkedOutAt: CHECKED_OUT_AT,
        checkedOutById: "user-1",
        checkedOutQuantity: 6,
        checkedInAt: null,
        checkedInById: null,
        asset: { type: AssetType.QUANTITY_TRACKED },
      },
    ]);
    mockOf(db.consumptionLog.findMany).mockResolvedValue([
      {
        assetId: "asset-1",
        bookingAssetId: null,
        category: "RETURN",
        quantity: 3,
        createdAt: LOGGED_AT,
        userId: "user-7",
      },
    ]);
    mockOf(db.user.findMany).mockResolvedValue([
      {
        id: "user-7",
        displayName: "Grace Hopper",
        firstName: null,
        lastName: null,
      },
    ]);

    const receipt = await run();

    expect(receipt.rows[0].checkedInAt).toEqual(LOGGED_AT);
    expect(receipt.rows[0].checkedInByName).toBe("Grace Hopper");
    expect(receipt.checkedInByNames).toEqual(["Grace Hopper"]);
  });

  it("leaves an untagged log undated when the asset has several slices", async () => {
    // One asset booked standalone and through a kit. An untagged log is split
    // between the two by a greedy pass that carries no times, so no row can
    // claim the moment without guessing which units it describes.
    mockOf(fetchAllPdfRelatedData).mockResolvedValue(
      pdfResultWith(
        [
          pdfRow("ba-1", "asset-1", "XLR cable"),
          pdfRow("ba-2", "asset-1", "XLR cable"),
        ],
        BookingStatus.ONGOING
      )
    );
    mockOf(db.bookingAsset.findMany).mockResolvedValue(
      ["ba-1", "ba-2"].map((id, index) => ({
        id,
        assetId: "asset-1",
        quantity: 3,
        assetKitId: index === 1 ? "ak-1" : null,
        checkedOutAt: CHECKED_OUT_AT,
        checkedOutById: "user-1",
        checkedOutQuantity: 3,
        checkedInAt: null,
        checkedInById: null,
        asset: { type: AssetType.QUANTITY_TRACKED },
      }))
    );
    mockOf(db.consumptionLog.findMany).mockResolvedValue([
      {
        assetId: "asset-1",
        bookingAssetId: null,
        category: "RETURN",
        quantity: 2,
        createdAt: LOGGED_AT,
        userId: "user-7",
      },
    ]);
    mockOf(db.user.findMany).mockResolvedValue([
      {
        id: "user-7",
        displayName: "Grace Hopper",
        firstName: null,
        lastName: null,
      },
    ]);

    const receipt = await run();

    for (const row of receipt.rows) {
      expect(row.checkedInAt).toBeNull();
      expect(row.checkedInByName).toBe("");
    }
    expect(receipt.checkedInByNames).toEqual([]);
  });
});
