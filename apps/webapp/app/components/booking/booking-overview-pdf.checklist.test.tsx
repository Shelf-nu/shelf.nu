/**
 * The Checklist sheet prints what the booking PDF printed before sheets existed.
 *
 * `__snapshots__/checklist-sheet.html` is the markup of the booking PDF for one
 * busy booking. A workspace's seeded "Checklist" sheet must keep printing that
 * same page, so nobody who never opens the sheet settings sees a change.
 *
 * @see {@link file://./booking-overview-pdf.tsx}
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PdfCodeImage } from "~/modules/barcode/pdf-code-image";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import { BookingPDFPreview } from "./booking-overview-pdf";

// why: the header renders `DateS`, which reads the acting user's format prefs
// through this hook. It reaches the root route loader, and a unit test has no
// router.
vi.mock("~/hooks/use-date-formatter", async () => {
  const actual = (await vi.importActual("~/utils/date-format")) as {
    formatDate: (
      value: string | Date,
      prefs: ResolvedFormatPrefs,
      opts?: DateFormatOptions
    ) => string;
  };
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H12",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  return {
    useDateFormatter: () => ({
      prefs,
      formatDate: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, opts),
      formatTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, onlyTime: true }),
      formatDateTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, includeTime: true }),
    }),
  };
});

const QR_IMAGE: PdfCodeImage = {
  src: "data:image/svg+xml;base64,PHN2Zy8+",
  shape: "square",
  placement: "cell",
};

const LINE_BARCODE: PdfCodeImage = {
  src: "data:image/svg+xml;base64,PHN2ZyBpZD0ibGluZSIvPg==",
  shape: "linear",
  placement: "line",
};

function row(overrides: Record<string, unknown>) {
  return {
    description: null,
    quantity: 1,
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    assetModel: null,
    category: null,
    location: null,
    kit: null,
    kitId: null,
    isRemovedFromKit: false,
    status: "AVAILABLE",
    ...overrides,
  };
}

/**
 * One booking that exercises every part of the page: custodian with an email,
 * a changed period, a description, tags, kit rows, a detached kit row, a code
 * printed on its own line, description rows, and an outstanding model request.
 */
export function busyBookingPdfMeta(): PdfDbResult {
  return {
    booking: {
      id: "booking-1",
      name: "Campaign Shoot",
      description: "Two days on location.\nLoad the van first.",
      custodianUser: {
        firstName: "Ada",
        lastName: "Lovelace",
        displayName: null,
        email: "ada@example.com",
      },
      custodianTeamMember: null,
      tags: [
        { id: "tag-1", name: "Outdoor", color: null },
        { id: "tag-2", name: "Client", color: null },
      ],
    },
    organization: {
      id: "org-1",
      name: "ACME",
      imageId: null,
      currency: "USD",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      qrIdDisplayPreference: "QR_ID",
      barcodesEnabled: true,
      showQrCodesOnPdfs: true,
    },
    assets: [
      row({
        id: "asset-1",
        bookingAssetId: "ba-1",
        title: "Canon C200",
        description: "Cinema camera with Super 35 sensor.",
        category: { name: "Camera" },
        location: { name: "Studio A" },
        kitId: "kit-1",
        kit: { id: "kit-1", name: "Camera kit", location: null },
      }),
      row({
        id: "asset-2",
        bookingAssetId: "ba-2",
        title: "Battery V-mount",
        quantity: 4,
        category: { name: "Batteries" },
        location: { name: "Studio A" },
        kitId: "kit-1",
        kit: { id: "kit-1", name: "Camera kit", location: null },
      }),
      row({
        id: "asset-3",
        bookingAssetId: "ba-3",
        title: "Old monitor",
        category: { name: "Monitors" },
        kitId: "kit-1",
        kit: { id: "kit-1", name: "Camera kit", location: null },
        isRemovedFromKit: true,
      }),
      row({
        id: "asset-4",
        bookingAssetId: "ba-4",
        title: "Aputure 300d",
        description: "x".repeat(320),
        category: { name: "Lighting" },
        location: { name: "Studio B" },
      }),
      row({
        id: "asset-5",
        bookingAssetId: "ba-5",
        title: "Sandbag",
        quantity: 6,
      }),
    ],
    totalValue: "$11,077.95",
    assetIdToCodeImageMap: {
      "asset-1": QR_IMAGE,
      "asset-2": QR_IMAGE,
      "asset-4": LINE_BARCODE,
    },
    assetIdToDisplayCodeMap: {
      "asset-1": {
        value: "QR-AAAA",
        type: "QR_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "QR_ID",
      },
      "asset-2": {
        value: "QR-BBBB",
        type: "QR_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "QR_ID",
      },
      "asset-4": {
        value: "AB-12345678901",
        type: "Code128",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "QR_ID",
      },
    },
    modelRequests: [
      {
        id: "req-1",
        assetModelId: "model-1",
        quantity: 3,
        fulfilledQuantity: 1,
        fulfilledAt: null,
        assetModel: { id: "model-1", name: "Tripod" },
      },
    ],
    from: "27/10/2026, 5:24 pm",
    to: "29/10/2026, 6:00 pm",
    originalFrom: "26/10/2026, 9:00 am",
    originalTo: "29/10/2026, 6:00 pm",
  } as unknown as PdfDbResult;
}

describe("booking PDF: the Checklist sheet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prints the same page as the booking PDF before sheets", async () => {
    const { container } = render(
      <BookingPDFPreview
        componentRef={{ current: null }}
        pdfMeta={busyBookingPdfMeta()}
      />
    );

    await expect(container.innerHTML).toMatchFileSnapshot(
      "./__snapshots__/checklist-sheet.html"
    );
  });
});
