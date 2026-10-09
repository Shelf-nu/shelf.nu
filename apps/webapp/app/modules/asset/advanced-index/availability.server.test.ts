// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { hydrateAvailabilityPage } from "./availability.server";
import type { CriticalRow } from "./types";

// why: isolates hydrateAvailabilityPage from the real batch fetchers — each
// test controls what bookings/barcodes come back (or throws) without a
// database.
const hydrateHeavyMock = vi.hoisted(() => ({
  fetchBookingsBatch: vi.fn(async () => new Map()),
  fetchBarcodesBatch: vi.fn(async () => new Map()),
}));
vi.mock("./hydrate-heavy.server", () => hydrateHeavyMock);

// why: replaces the real concurrency-limited withReadSlot with a passthrough
// that just invokes fn — the limiter's own scheduling is covered by its own
// test file, not this one. Individual tests can still override it (e.g. to
// simulate an abort rejection) via `mockImplementationOnce`.
const withReadSlotMock = vi.hoisted(() =>
  vi.fn((fn: () => Promise<unknown>) => fn())
);
vi.mock("~/utils/read-batch-limiter.server", () => ({
  withReadSlot: withReadSlotMock,
}));

// why: lets degrade assertions check Logger.error fired without emitting
// real log noise during the test run.
const mockLoggerError = vi.hoisted(() => vi.fn());
vi.mock("~/utils/logger", () => ({
  Logger: { error: mockLoggerError },
}));

const ORG_ID = "org-1";
const VIEWER_SCOPE = { userId: "user-1", canSeeAllCustody: true };

/** Builds a minimal, fully-typed `CriticalRow`; individual tests override fields. */
function makeCriticalRow(overrides: Partial<CriticalRow> = {}): CriticalRow {
  return {
    id: "asset-1",
    title: "Camera",
    description: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    userId: "user-1",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    categoryId: null,
    organizationId: ORG_ID,
    status: "AVAILABLE",
    type: "INDIVIDUAL",
    valuation: null,
    quantity: null,
    unitOfMeasure: null,
    minQuantity: null,
    consumptionType: null,
    availableToBook: true,
    sequentialId: null,
    qrId: "qr-1",
    assetModel: null,
    category: null,
    kit: null,
    ...overrides,
  };
}

const booking = {
  id: "booking-1",
  name: "Weekend shoot",
  description: null,
  status: "RESERVED" as const,
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-03T00:00:00.000Z",
  tags: [],
  custodianTeamMember: null,
  custodianUser: null,
  creator: null,
  assetKitId: null,
  quantity: null,
  kitName: null,
};

const barcode = { id: "barcode-1", type: "Code128" as const, value: "12345" };

describe("hydrateAvailabilityPage", () => {
  it("attaches bookings and barcodes to each row, in input order, with every other field at its empty default", async () => {
    hydrateHeavyMock.fetchBookingsBatch.mockResolvedValueOnce(
      new Map([["asset-1", [booking]]])
    );
    hydrateHeavyMock.fetchBarcodesBatch.mockResolvedValueOnce(
      new Map([["asset-2", [barcode]]])
    );

    const items = [
      makeCriticalRow({ id: "asset-1" }),
      makeCriticalRow({ id: "asset-2" }),
    ];

    const result = await hydrateAvailabilityPage({
      items,
      organizationId: ORG_ID,
      viewerScope: VIEWER_SCOPE,
      barcodesEnabled: true,
      signal: new AbortController().signal,
    });

    expect(result.map((r) => r.id)).toEqual(["asset-1", "asset-2"]);
    expect(result[0].bookings).toEqual([booking]);
    expect(result[0].barcodes).toEqual([]);
    expect(result[1].bookings).toEqual([]);
    expect(result[1].barcodes).toEqual([barcode]);

    for (const row of result) {
      expect(row.tags).toEqual([]);
      expect(row.locations).toEqual([]);
      expect(row.location).toBeNull();
      expect(row.kits).toEqual([]);
      expect(row.customFields).toEqual([]);
      expect(row.reminders).toBeNull();
      expect(row.custody).toBeNull();
    }
  });

  it("never calls fetchBarcodesBatch when the entitlement is off, and every row's barcodes stay empty", async () => {
    hydrateHeavyMock.fetchBookingsBatch.mockResolvedValueOnce(
      new Map([["asset-1", [booking]]])
    );
    hydrateHeavyMock.fetchBarcodesBatch.mockClear();

    const items = [makeCriticalRow({ id: "asset-1" })];

    const result = await hydrateAvailabilityPage({
      items,
      organizationId: ORG_ID,
      viewerScope: VIEWER_SCOPE,
      barcodesEnabled: false,
      signal: new AbortController().signal,
    });

    expect(hydrateHeavyMock.fetchBarcodesBatch).not.toHaveBeenCalled();
    expect(result[0].barcodes).toEqual([]);
    expect(result[0].bookings).toEqual([booking]);
  });

  it("degrades bookings to empty on failure without throwing or affecting barcodes", async () => {
    hydrateHeavyMock.fetchBookingsBatch.mockRejectedValueOnce(
      new Error("db down")
    );
    hydrateHeavyMock.fetchBarcodesBatch.mockResolvedValueOnce(
      new Map([["asset-1", [barcode]]])
    );
    mockLoggerError.mockClear();

    const items = [makeCriticalRow({ id: "asset-1" })];

    const result = await hydrateAvailabilityPage({
      items,
      organizationId: ORG_ID,
      viewerScope: VIEWER_SCOPE,
      barcodesEnabled: true,
      signal: new AbortController().signal,
    });

    expect(result[0].bookings).toEqual([]);
    expect(result[0].barcodes).toEqual([barcode]);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it("degrades barcodes to empty on failure without throwing or affecting bookings", async () => {
    hydrateHeavyMock.fetchBookingsBatch.mockResolvedValueOnce(
      new Map([["asset-1", [booking]]])
    );
    hydrateHeavyMock.fetchBarcodesBatch.mockRejectedValueOnce(
      new Error("db down")
    );
    mockLoggerError.mockClear();

    const items = [makeCriticalRow({ id: "asset-1" })];

    const result = await hydrateAvailabilityPage({
      items,
      organizationId: ORG_ID,
      viewerScope: VIEWER_SCOPE,
      barcodesEnabled: true,
      signal: new AbortController().signal,
    });

    expect(result[0].barcodes).toEqual([]);
    expect(result[0].bookings).toEqual([booking]);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });

  it("degrades to an empty map, not a throw, when a batch's read slot rejects with an abort", async () => {
    withReadSlotMock.mockImplementationOnce(() =>
      Promise.reject(new DOMException("aborted", "AbortError"))
    );
    hydrateHeavyMock.fetchBarcodesBatch.mockResolvedValueOnce(
      new Map([["asset-1", [barcode]]])
    );
    mockLoggerError.mockClear();

    const items = [makeCriticalRow({ id: "asset-1" })];

    const result = await hydrateAvailabilityPage({
      items,
      organizationId: ORG_ID,
      viewerScope: VIEWER_SCOPE,
      barcodesEnabled: true,
      signal: new AbortController().signal,
    });

    // The first withReadSlot call (bookings) is the one overridden above —
    // it rejects and degrades; barcodes' own call still runs normally.
    expect(result[0].bookings).toEqual([]);
    expect(result[0].barcodes).toEqual([barcode]);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});
