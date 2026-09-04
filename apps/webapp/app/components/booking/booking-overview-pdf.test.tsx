/**
 * The Code column of the booking checklist PDF.
 *
 * The checklist is printed and carried around a warehouse, so each row has to
 * carry the identifier the picker reads off the shelf. A sheet of QR images
 * alone leaves a SAM ID workspace translating every row by hand.
 *
 * These tests are about what ends up ON PAPER: that the code is printed, that
 * it sits with the QR image rather than in some other column, and that a row
 * whose preferred code was unavailable says so — the badge's tooltip, which is
 * how the app explains that on screen, does not survive printing.
 *
 * @see {@link file://./booking-overview-pdf.tsx}
 * @see {@link file://../assets/asset-code-print-text.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import { BookingPDFPreview } from "./booking-overview-pdf";

// why: the header renders `DateS`, which reads the acting user's format prefs
// through this hook — it reaches the root route loader, and there is no router
// in a unit test. Same stub shape as `reports/report-table.test.tsx`.
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

const QR_IMAGE = "data:image/png;base64,iVBORw0KGgo=";

/**
 * A one-row `PdfDbResult`. Cast rather than spelled out: the real shape is a
 * full Prisma `Asset` plus the per-slice fields, and none of the ~40 columns
 * this component never reads would make the test say more.
 */
function pdfMetaWith({
  displayCode,
  qrImage = QR_IMAGE,
  showQrCodesOnPdfs = true,
}: {
  displayCode: PdfDbResult["assetIdToDisplayCodeMap"][string] | undefined;
  qrImage?: string | null;
  showQrCodesOnPdfs?: boolean;
}): PdfDbResult {
  return {
    booking: {
      id: "booking-1",
      name: "Shoot",
      description: null,
      custodianUser: null,
      custodianTeamMember: { name: "Ada" },
      tags: [],
    },
    organization: {
      id: "org-1",
      name: "Org",
      imageId: null,
      currency: "USD",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      qrIdDisplayPreference: "SAM_ID",
      barcodesEnabled: false,
      showQrCodesOnPdfs,
    },
    assets: [
      {
        id: "asset-1",
        bookingAssetId: "ba-1",
        title: "Tripod",
        description: null,
        quantity: 2,
        mainImage: null,
        thumbnailImage: null,
        mainImageExpiration: null,
        assetModel: null,
        category: { name: "Support" },
        location: { name: "Studio" },
        kit: null,
        isRemovedFromKit: false,
      },
    ],
    totalValue: "$100",
    assetIdToQrCodeMap: qrImage ? { "asset-1": qrImage } : {},
    assetIdToDisplayCodeMap: displayCode ? { "asset-1": displayCode } : {},
    modelRequests: [],
  } as unknown as PdfDbResult;
}

/** Renders the printable checklist body around a single asset row. */
function renderPreview(args: Parameters<typeof pdfMetaWith>[0]) {
  return render(
    <BookingPDFPreview
      componentRef={{ current: null }}
      pdfMeta={pdfMetaWith(args)}
    />
  );
}

/**
 * The table cell holding the row's code — located by the QR `<img>`, which the
 * checklist renders unconditionally (with an empty `src` when no image was
 * generated), so the no-image case finds the same cell.
 */
function codeCell() {
  const cell = screen.getByAltText("QR Code").closest("td");
  expect(cell).not.toBeNull();
  return cell as HTMLTableCellElement;
}

describe("booking checklist PDF — Code column", () => {
  it("prints the workspace's preferred code beside the QR image", () => {
    renderPreview({
      displayCode: {
        value: "SAM-0001",
        type: "SAM_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
    });

    // why: `getByText` alone would pass if the code were printed in the Name
    // column, or anywhere else on the sheet. The column is the claim.
    expect(codeCell()).toHaveTextContent("SAM-0001");
  });

  it("says which code it fell back to when the preferred one is missing", () => {
    // why: on screen the outlined badge + tooltip carry this. Paper has no
    // hover, so an unexplained QR id where the workspace expects a SAM ID
    // reads as the feature being broken.
    renderPreview({
      displayCode: {
        value: "qr-visible-id",
        type: "QR_ID",
        isFallback: true,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
    });

    const cell = codeCell();
    expect(cell).toHaveTextContent("qr-visible-id");
    expect(cell).toHaveTextContent("QR Code ID");
  });

  it("prints no caption when the code is the one the workspace asked for", () => {
    renderPreview({
      displayCode: {
        value: "SAM-0001",
        type: "SAM_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
    });

    expect(codeCell()).not.toHaveTextContent("SAM ID");
  });

  it("still renders the row when no code resolved", () => {
    // why: defensive. Every asset has a QR fallback, so an empty map means a
    // caller bug — which must not take the whole checklist down.
    renderPreview({ displayCode: undefined });

    expect(screen.getByText("Tripod")).toBeInTheDocument();
    expect(codeCell()).toBeInTheDocument();
  });

  it("prints the code even when no QR image was generated", () => {
    // why: the image is generated per request, and `getQrCodeMaps` leaves out
    // any asset whose generation threw, so a row can arrive with no image. The
    // code is what a picker matches against the shelf, so it must not be
    // rendered behind the image's presence the way the image itself is.
    renderPreview({
      displayCode: {
        value: "SAM-0001",
        type: "SAM_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
      qrImage: null,
    });

    expect(codeCell()).toHaveTextContent("SAM-0001");
    // The `<img>` still renders, sourceless — the code is what carries the row.
    expect(codeCell().querySelector("img")?.getAttribute("src")).toBeFalsy();
  });

  it("prints no QR image when the workspace turned them off", () => {
    // why: the sheet carries the same codes as the labels on the equipment, so
    // a workspace that wants people scanning the item itself has to be able to
    // stop the sheet being scannable. The code stays: the row still has to be
    // matchable by eye, which is the whole point of turning the image off.
    renderPreview({
      displayCode: {
        value: "SAM-0001",
        type: "SAM_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
      showQrCodesOnPdfs: false,
    });

    expect(screen.queryByAltText("QR Code")).not.toBeInTheDocument();
    expect(screen.getByText("SAM-0001")).toBeInTheDocument();
  });

  it("keeps the pick-off checkbox when the QR image is off", () => {
    // why: the tick box is how a picker works the sheet; hiding the image must
    // not take it with it.
    renderPreview({
      displayCode: {
        value: "SAM-0001",
        type: "SAM_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
      showQrCodesOnPdfs: false,
    });

    expect(
      screen.getByRole("checkbox", { name: "Mark Tripod as picked" })
    ).toBeInTheDocument();
  });

  it("keeps a named pick-off checkbox in the code cell", () => {
    // why: one sheet carries a checkbox per row, so the name has to say WHICH
    // asset is being ticked or a screen reader reads a column of bare boxes.
    renderPreview({
      displayCode: {
        value: "SAM-0001",
        type: "SAM_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
    });

    const checkbox = screen.getByRole("checkbox", {
      name: "Mark Tripod as picked",
    });

    expect(codeCell()).toContainElement(checkbox);
  });
});
