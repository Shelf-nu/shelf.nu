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
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
}: {
  displayCode: AuditPdfDbResult["assetIdToDisplayCodeMap"][string] | undefined;
  qrImage?: string | null;
  showQrCodesOnPdfs?: boolean;
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
        thumbnailImage: null,
        category: null,
        location: null,
        auditData: { expected: true, auditStatus: "SCANNED" },
      },
    ],
    assetIdToQrCodeMap: qrImage ? { "asset-1": qrImage } : {},
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
