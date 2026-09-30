/**
 * The Code column of the audit receipt PDF.
 *
 * The receipt is the audit's output — the sheet somebody keeps, attaches to a
 * claim, or walks the shelves with. Its asset table prints the code a reader
 * matches against a physical label, so a workspace that labels its equipment
 * with SAM IDs can work the sheet without a scanner.
 *
 * @see {@link file://./audit-receipt-pdf.tsx}
 * @see {@link file://../assets/asset-code-print-text.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ASSET_IMAGE_PLACEHOLDER } from "~/modules/asset/image-resolution";
import type { AuditPdfDbResult } from "~/modules/audit/pdf-helpers";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import { AuditPDFContent } from "./audit-receipt-pdf";

// why: the receipt renders `DateS`, which reads the acting user's format prefs
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
 * A one-asset receipt. Cast rather than spelled out: the real shape is a full
 * Prisma `Asset` plus audit status, and none of the columns this component
 * never reads would make the test say more.
 */
function pdfMetaWith({
  displayCode,
  qrImage = QR_IMAGE,
  showQrCodesOnPdfs = true,
  asset = {},
}: {
  displayCode: AuditPdfDbResult["assetIdToDisplayCodeMap"][string] | undefined;
  /** The row's code picture; `null` for a row with none. */
  qrImage?: string | null;
  showQrCodesOnPdfs?: boolean;
  /** Image fields to override on the one asset row. */
  asset?: Partial<{
    mainImage: string | null;
    thumbnailImage: string | null;
    assetModel: { image: string | null; thumbnailImage: string | null } | null;
  }>;
}): AuditPdfDbResult {
  return {
    session: {
      id: "audit-1",
      name: "Quarterly check",
      status: "COMPLETED",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: new Date("2026-01-02T00:00:00.000Z"),
      dueDate: null,
      expectedAssetCount: 1,
      scannedAssetCount: 1,
      missingAssetCount: 0,
      unexpectedAssetCount: 0,
      createdBy: {
        firstName: "Ada",
        lastName: "L",
        displayName: null,
        email: "ada@example.com",
        profilePicture: null,
      },
      assignments: [],
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
        title: "Camera",
        mainImage: null,
        thumbnailImage: null,
        assetModel: null,
        category: null,
        location: null,
        auditData: { expected: true, auditStatus: "SCANNED" },
        ...asset,
      },
    ],
    assetIdToCodeImageMap: qrImage ? { "asset-1": qrImage } : {},
    assetIdToDisplayCodeMap: displayCode ? { "asset-1": displayCode } : {},
    generalImages: [],
    assetImages: [],
    conditionNotes: [],
    activityNotes: [],
  } as unknown as AuditPdfDbResult;
}

const SAM_CODE = {
  value: "SAM-0001",
  type: "SAM_ID",
  isFallback: false,
  entityKind: "asset",
  workspacePreference: "SAM_ID",
} as AuditPdfDbResult["assetIdToDisplayCodeMap"][string];

function renderReceipt(
  args: Parameters<typeof pdfMetaWith>[0]
): ReturnType<typeof render> {
  return render(
    <AuditPDFContent
      componentRef={{ current: null }}
      pdfMeta={pdfMetaWith(args)}
    />
  );
}

/** The table cell holding the row's code — found by the row, not by the image,
 * so the no-image case can use the same helper. */
function codeCell() {
  const cells = screen
    .getByText("Camera")
    .closest("tr")
    ?.querySelectorAll("td");
  expect(cells).toBeTruthy();
  return cells![cells!.length - 1];
}

describe("audit receipt PDF — Code column", () => {
  it('heads the column "Code"', () => {
    // why: the column holds the identifier a reader matches against the
    // shelf. The QR image is one rendering of that identifier, not a second
    // thing, so the header names the code rather than the image.
    renderReceipt({ displayCode: SAM_CODE });

    expect(
      screen.getByRole("columnheader", { name: "Code" })
    ).toBeInTheDocument();
  });

  it("prints the workspace's preferred code beside the QR image", () => {
    renderReceipt({ displayCode: SAM_CODE });

    const cell = codeCell();
    expect(cell).toHaveTextContent("SAM-0001");
    expect(cell.querySelector("img")).not.toBeNull();
  });

  it("prints the code even when no QR image was generated", () => {
    // why: the image is generated per request, and `getQrCodeMaps` leaves out
    // any asset whose generation threw, so a row can arrive with no image. The
    // code is the part the receipt exists to record, so it must not be
    // conditional on the image the way the image itself is.
    renderReceipt({ displayCode: SAM_CODE, qrImage: null });

    const cell = codeCell();
    expect(cell).toHaveTextContent("SAM-0001");
    expect(cell.querySelector("img")).toBeNull();
  });

  it("says which code it fell back to when the preferred one is missing", () => {
    // why: on screen the outlined badge + tooltip carry this. Paper has no
    // hover, so an unexplained QR id where the workspace expects a SAM ID
    // reads as the feature being broken.
    renderReceipt({
      displayCode: {
        value: "qr-visible-id",
        type: "QR_ID",
        isFallback: true,
        entityKind: "asset",
        workspacePreference: "SAM_ID",
      } as AuditPdfDbResult["assetIdToDisplayCodeMap"][string],
    });

    const cell = codeCell();
    expect(cell).toHaveTextContent("qr-visible-id");
    expect(cell).toHaveTextContent("QR Code ID");
  });

  it("prints no QR image when the workspace turned them off", () => {
    // why: an audit records what was physically present, so a receipt whose QR
    // can be scanned from a desk undermines the record it is. The code stays,
    // so the row is still matchable by eye.
    renderReceipt({ displayCode: SAM_CODE, showQrCodesOnPdfs: false });

    expect(codeCell().querySelector("img")).toBeNull();
    expect(codeCell()).toHaveTextContent("SAM-0001");
  });

  it("still renders the row when no code resolved", () => {
    // why: defensive. Every asset has a QR fallback, so an empty map means a
    // caller bug — which must not take the whole receipt down.
    renderReceipt({ displayCode: undefined });

    expect(screen.getByText("Camera")).toBeInTheDocument();
  });
});

const CODE128_CODE = {
  value: "AB-12345678",
  type: "Code128",
  isFallback: false,
  entityKind: "asset",
  workspacePreference: "Code128",
} as AuditPdfDbResult["assetIdToDisplayCodeMap"][string];

const BARCODE_PICTURE = "data:image/svg+xml;base64,PHN2Zy8+";

describe("audit receipt PDF: the code picture", () => {
  it("prints a linear barcode at the size its picture declares", () => {
    // why: the server sized the SVG so each bar is exactly one module wide. A
    // square box would squash the bars and the printed barcode would stop
    // scanning.
    renderReceipt({ displayCode: CODE128_CODE, qrImage: BARCODE_PICTURE });

    const picture = codeCell().querySelector("img")!;
    expect(picture).toHaveAttribute("src", BARCODE_PICTURE);
    expect(picture).toHaveAttribute("data-code-shape", "linear");
    expect(picture.className).not.toMatch(/size-|object-cover/);
  });

  it("prints a 2D barcode square, at the QR's size", () => {
    renderReceipt({
      displayCode: { ...CODE128_CODE, type: "ExternalQR" },
      qrImage: BARCODE_PICTURE,
    });

    expect(codeCell().querySelector("img")).toHaveClass("size-16");
  });

  it("prints no picture, only the code, when the row has no picture", () => {
    renderReceipt({ displayCode: CODE128_CODE, qrImage: null });

    expect(codeCell().querySelector("img")).toBeNull();
    expect(codeCell()).toHaveTextContent("AB-12345678");
  });
});

describe("audit receipt PDF: photos", () => {
  /** The row's photo: the image in the row's second cell. */
  function photo() {
    return screen
      .getByText("Camera")
      .closest("tr")!
      .querySelectorAll("td")[1]
      .querySelector("img")!;
  }

  it("prints the model's cover for an asset with no photo of its own", () => {
    renderReceipt({
      displayCode: CODE128_CODE,
      asset: {
        assetModel: {
          image: "https://img/model.jpg",
          thumbnailImage: "https://img/model-thumb.jpg",
        },
      },
    });

    expect(photo()).toHaveAttribute("src", "https://img/model-thumb.jpg");
    expect(photo()).not.toHaveAttribute("loading");
  });

  it("prints the placeholder for an asset with no photo at all", () => {
    renderReceipt({ displayCode: CODE128_CODE });

    expect(photo()).toHaveAttribute("src", ASSET_IMAGE_PLACEHOLDER);
  });

  it("swaps a photo that fails to load for the placeholder", () => {
    // why: a lapsed signed URL prints a broken-image icon otherwise.
    renderReceipt({
      displayCode: CODE128_CODE,
      asset: {
        mainImage: "https://img/expired.jpg",
        thumbnailImage: "https://img/expired-thumb.jpg",
      },
    });

    fireEvent.error(photo());

    expect(photo()).toHaveAttribute("src", ASSET_IMAGE_PLACEHOLDER);
  });
});

describe("audit receipt PDF: layout", () => {
  it("fixes the table to the page width, one share per column", () => {
    // why: a table sized by its content runs off the page when a name or a
    // location is long; a fixed table wraps inside its columns instead.
    const { container } = renderReceipt({ displayCode: CODE128_CODE });

    const table = container.querySelector("table.audit-assets-table")!;
    const widths = [...table.querySelectorAll("col")].map((col) =>
      parseFloat((col as HTMLElement).style.width)
    );

    expect(table).toHaveClass("table-fixed");
    expect(widths).toHaveLength(table.querySelectorAll("thead th").length);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(100);
  });
});
