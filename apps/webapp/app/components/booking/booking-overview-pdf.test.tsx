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
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ASSET_IMAGE_PLACEHOLDER } from "~/modules/asset/image-resolution";
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
  description = null,
  asset = {},
}: {
  displayCode: PdfDbResult["assetIdToDisplayCodeMap"][string] | undefined;
  /** The row's code picture; `null` for a row with none. */
  qrImage?: string | null;
  showQrCodesOnPdfs?: boolean;
  description?: string | null;
  /** Fields to override on the one asset row. */
  asset?: Partial<{
    description: string | null;
    mainImage: string | null;
    thumbnailImage: string | null;
    assetModel: { image: string | null; thumbnailImage: string | null } | null;
  }>;
}): PdfDbResult {
  return {
    booking: {
      id: "booking-1",
      name: "Shoot",
      description,
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
        ...asset,
      },
    ],
    totalValue: "$100",
    assetIdToCodeImageMap: qrImage ? { "asset-1": qrImage } : {},
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
 * The table cell holding the row's code — the last cell of the asset's row.
 *
 * Located by the row rather than by the QR image, because the image is absent
 * whenever there is nothing to show: no code generated, or the workspace turned
 * QR images off.
 */
function codeCell() {
  const cells = screen
    .getByText("Tripod")
    .closest("tr")
    ?.querySelectorAll("td");
  expect(cells).toBeTruthy();
  return cells![cells!.length - 1];
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
    // why: no entry means no image to show, so the element is omitted rather
    // than rendered with an empty `src`. Same as the audit receipt.
    expect(codeCell().querySelector("img")).toBeNull();
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

    expect(screen.queryByAltText("Code of Tripod")).not.toBeInTheDocument();
    expect(codeCell()).toHaveTextContent("SAM-0001");
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

const CODE128_CODE = {
  value: "AB-12345678",
  type: "Code128",
  isFallback: false,
  entityKind: "asset",
  workspacePreference: "Code128",
} as PdfDbResult["assetIdToDisplayCodeMap"][string];

const BARCODE_PICTURE = "data:image/svg+xml;base64,PHN2Zy8+";

describe("booking checklist PDF: the code picture", () => {
  it("prints a linear barcode at the size its picture declares", () => {
    // why: the server sized the SVG so each bar is exactly one module wide. A
    // square box (the QR's size-14) would squash the bars or crop the quiet
    // zones, and the printed barcode would stop scanning.
    renderPreview({ displayCode: CODE128_CODE, qrImage: BARCODE_PICTURE });

    const picture = codeCell().querySelector("img")!;
    expect(picture).toHaveAttribute("src", BARCODE_PICTURE);
    expect(picture).toHaveAttribute("data-code-shape", "linear");
    expect(picture.className).not.toMatch(/size-|object-cover/);
  });

  it("prints a 2D barcode square, at the QR's size", () => {
    renderPreview({
      displayCode: { ...CODE128_CODE, type: "DataMatrix" },
      qrImage: BARCODE_PICTURE,
    });

    const picture = codeCell().querySelector("img")!;
    expect(picture).toHaveAttribute("data-code-shape", "square");
    expect(picture).toHaveClass("size-14");
  });

  it("prints the Shelf QR square", () => {
    renderPreview({
      displayCode: {
        value: "SAM-0001",
        type: "SAM_ID",
        isFallback: false,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      },
    });

    expect(codeCell().querySelector("img")).toHaveClass("size-14");
  });

  it("prints no picture, only the code, when the row has no picture", () => {
    // why: a barcode too wide for the column, or one its format refuses, gets
    // no entry. A QR in its place would be a picture of a DIFFERENT code.
    renderPreview({ displayCode: CODE128_CODE, qrImage: null });

    expect(codeCell().querySelector("img")).toBeNull();
    expect(codeCell()).toHaveTextContent("AB-12345678");
  });
});

describe("booking checklist PDF: photos", () => {
  it("never lazy-loads a photo", () => {
    // why: the sheet is printed from a copy of the page, and a lazy photo
    // below the fold has not loaded when the copy is taken.
    const { container } = renderPreview({
      displayCode: CODE128_CODE,
      asset: { mainImage: "https://img/main.jpg", thumbnailImage: null },
    });

    const table = container.querySelector("table.booking-assets-table")!;
    expect(table.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(table.querySelectorAll("img[loading]")).toHaveLength(0);
  });

  it("prints the asset's thumbnail", () => {
    renderPreview({
      displayCode: CODE128_CODE,
      asset: {
        mainImage: "https://img/main.jpg",
        thumbnailImage: "https://img/thumb.jpg",
      },
    });

    expect(screen.getByAltText("Image of Tripod")).toHaveAttribute(
      "src",
      "https://img/thumb.jpg"
    );
  });

  it("prints the model's cover for an asset with no photo of its own", () => {
    renderPreview({
      displayCode: CODE128_CODE,
      asset: {
        assetModel: {
          image: "https://img/model.jpg",
          thumbnailImage: "https://img/model-thumb.jpg",
        },
      },
    });

    expect(screen.getByAltText("Image of Tripod")).toHaveAttribute(
      "src",
      "https://img/model-thumb.jpg"
    );
  });

  it("swaps a photo that fails to load for the placeholder", () => {
    // why: a lapsed signed URL prints a broken-image icon otherwise.
    renderPreview({
      displayCode: CODE128_CODE,
      asset: { mainImage: "https://img/expired.jpg", thumbnailImage: null },
    });

    const photo = screen.getByAltText("Image of Tripod");
    fireEvent.error(photo);

    expect(photo).toHaveAttribute("src", ASSET_IMAGE_PLACEHOLDER);
  });
});

describe("booking checklist PDF: layout", () => {
  it("prints the Description row only when the booking has one", () => {
    const { unmount } = renderPreview({
      displayCode: CODE128_CODE,
      description: "   ",
    });
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    unmount();

    renderPreview({ displayCode: CODE128_CODE, description: "Studio shoot" });
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Studio shoot")).toBeInTheDocument();
  });

  it("gives each asset its own row group, description included", () => {
    // why: the print styles keep a row group whole across a page break. With
    // every row in one shared group, a description can land at the top of the
    // next page with no asset above it.
    const pdfMeta = pdfMetaWith({
      displayCode: CODE128_CODE,
      asset: { description: "Carbon legs, 1.5 m" },
    });
    pdfMeta.assets = [
      ...pdfMeta.assets,
      {
        ...pdfMeta.assets[0],
        id: "asset-2",
        bookingAssetId: "ba-2",
        title: "Light stand",
        description: null,
      },
    ];
    render(
      <BookingPDFPreview componentRef={{ current: null }} pdfMeta={pdfMeta} />
    );

    const tripodGroup = screen.getByText("Tripod").closest("tr")!.parentElement;
    const descriptionGroup = screen
      .getByText("Carbon legs, 1.5 m")
      .closest("tr")!.parentElement;
    const standGroup = screen
      .getByText("Light stand")
      .closest("tr")!.parentElement;

    expect(tripodGroup?.tagName).toBe("TBODY");
    expect(descriptionGroup).toBe(tripodGroup);
    expect(standGroup).not.toBe(tripodGroup);
  });

  it("fixes the table to the page width, one share per column", () => {
    // why: a table sized by its content runs off the page when a name or a
    // code is long; a fixed table wraps inside its columns instead.
    const { container } = renderPreview({ displayCode: CODE128_CODE });

    const table = container.querySelector("table.booking-assets-table")!;
    const widths = [...table.querySelectorAll("col")].map((col) =>
      parseFloat((col as HTMLElement).style.width)
    );
    const headers = table.querySelectorAll("thead th");

    expect(table).toHaveClass("table-fixed");
    expect(widths).toHaveLength(headers.length);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(100);
  });
});
