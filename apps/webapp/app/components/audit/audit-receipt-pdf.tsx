import type React from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { AuditStatus, AuditAssetStatus } from "@prisma/client";
import {
  AUDIT_ASSET_STATUS_LABELS,
  auditAssetStatusLabel,
  isAuditCompleted,
} from "@shelf/labels";
import { useReactToPrint } from "react-to-print";
import useApiQuery from "~/hooks/use-api-query";
import { getAuditStatusLabel } from "~/modules/audit/audit-filter-utils";
import type { AuditPdfDbResult } from "~/modules/audit/pdf-helpers";
import { PDF_CODE_COLUMN_PERCENT } from "~/modules/barcode/pdf-code-image";
import { sanitizeFilename } from "~/utils/sanitize-filename";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import { AuditAssetStatusBadge } from "./audit-asset-status-badge";
import { AuditStatusBadgeWithOverdue } from "./audit-status-badge-with-overdue";
import { AssetCodePrintImage } from "../assets/asset-code-print-image";
import { AssetCodePrintText } from "../assets/asset-code-print-text";
import { AssetPrintImage } from "../assets/asset-print-image";
import { CategoryBadge } from "../assets/category-badge";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import { GrayBadge } from "../shared/gray-badge";
import { Image } from "../shared/image";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

/**
 * Widths of the asset table's columns, in percent, in column order. They sum
 * to 100 and the table is `table-fixed`, so the table is exactly the printable
 * width and no cell's content can push it off the page; long text wraps inside
 * its column instead. The Code column's share is shared with the server, which
 * refuses a barcode picture wider than that cell.
 */
const ASSET_TABLE_COLUMNS = [
  { name: "number", percent: 5 },
  { name: "image", percent: 9 },
  { name: "name", percent: 15 },
  { name: "category", percent: 16 },
  { name: "location", percent: 14 },
  { name: "status", percent: 14 },
  { name: "code", percent: PDF_CODE_COLUMN_PERCENT },
] as const;

/**
 * Lets a badge in a narrow table cell wrap its words instead of running past
 * the cell's edge. The badges size to their text by default. The slimmer
 * padding keeps a common label such as "Uncategorized" on one line.
 */
const WRAPPING_BADGE_CLASS =
  "w-auto max-w-full px-1.5 [overflow-wrap:anywhere]";

/**
 * Props for the AuditReceiptPDF component
 */
interface AuditReceiptPDFProps {
  audit: {
    id: string;
    name: string;
    status: AuditStatus;
  };
  open: boolean;
  onClose: () => void;
}

/**
 * Component that generates and downloads an audit receipt PDF.
 * Renders a preview dialog with a manual "Download PDF" action.
 */
export const AuditReceiptPDF = ({
  audit,
  open,
  onClose,
}: AuditReceiptPDFProps) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const [pdfMeta, setPdfMeta] = useState<AuditPdfDbResult | null>(null);

  // Configure print handler with sanitized filename
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `audit-receipt-${sanitizeFilename(
      audit.name
    )}-${Date.now()}`,
  });

  const { error } = useApiQuery<{ pdfMeta?: AuditPdfDbResult }>({
    api: `/api/audits/${audit.id}/generate-pdf`,
    // Avoid refetching on re-renders once the preview data is loaded.
    enabled: open && !pdfMeta,
    onSuccess: (payload) => {
      setPdfMeta(payload?.pdfMeta ?? null);
    },
    onError: () => {
      setPdfMeta(null);
    },
  });

  // Derive the loading state at render time from the query's inputs/outputs
  // instead of mirroring it into a setState chained inside a useEffect.
  // This removes the previous cascading setState pair (and the
  // effect-event-handler it lived in) — dialog close now only resets the
  // cached meta; loading visibility falls out of this expression.
  const isFetchingReceipt = open && !pdfMeta && !error;

  // When the dialog closes we still need to discard the cached meta so the
  // next open refetches. This effect performs exactly one state transition
  // (never cascading) and only runs on a genuine open→closed boundary.
  useEffect(() => {
    if (!open) {
      setPdfMeta(null);
    }
  }, [open]);

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={onClose}
        className="h-dvh w-full md:h-[calc(100vh-4rem)] md:w-[90%] md:py-0"
        title={
          <div className="mx-auto w-full max-w-[210mm] border p-4 text-center">
            <h3>Generate audit receipt for "{audit.name}"</h3>
            <p>You can preview the receipt and then download the PDF.</p>
            {!isFetchingReceipt && (
              <div className="mt-4">
                <Button type="button" onClick={handlePrint}>
                  Download PDF
                </Button>
              </div>
            )}
          </div>
        }
      >
        <div className="flex h-full flex-col px-6">
          <div className="grow">
            {isFetchingReceipt ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <div>Generating receipt preview...</div>
                <div>
                  <Spinner />
                </div>
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <div className="text-sm text-gray-600">
                  We couldn't load the receipt preview.
                </div>
                <div className="text-xs text-gray-500">
                  Please close the dialog and try again.
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="border bg-gray-200 py-4">
                  <AuditPDFContent
                    componentRef={componentRef}
                    pdfMeta={pdfMeta}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 py-4">
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </DialogPortal>
  );
};

/**
 * PDF content component that renders the actual audit receipt layout.
 *
 * @param componentRef - Ref to the printable content container
 * @param pdfMeta - All audit data needed for the PDF (note content is already sanitized server-side)
 */
// react-doctor:no-giant-component — deferred for follow-up refactor
export const AuditPDFContent = ({
  componentRef,
  pdfMeta,
}: {
  componentRef: React.RefObject<HTMLDivElement | null>;
  pdfMeta: AuditPdfDbResult | null;
}) => {
  if (!pdfMeta) return null;

  const {
    session,
    organization,
    assets,
    assetIdToCodeImageMap,
    assetIdToDisplayCodeMap,
    generalImages,
    assetImages,
    conditionNotes,
    activityNotes,
  } = pdfMeta;

  // An audit is a claim about what was physically present, so a receipt whose
  // codes can be scanned from the desk undermines the thing it records.
  // Workspaces that care turn the pictures off; the text code still prints.
  const showCodeImages = organization.showQrCodesOnPdfs ?? true;

  // why: the receipt can be downloaded at ANY point in an audit's life — the
  // Actions dropdown offers it with no status gate — so it must apply the same
  // completion rule as the screen it was printed from. `missingAssetCount` is
  // seeded with the full expected count at creation, so it only means "lost"
  // once the audit is complete.
  const auditIsCompleted = isAuditCompleted(session);
  const unscannedLabel = auditAssetStatusLabel("PENDING", auditIsCompleted);

  // Format creator name from user data or fallback to email
  const creatorName =
    resolveUserDisplayName(session.createdBy) ||
    session.createdBy?.email ||
    "Unknown";

  // Format assignee names as comma-separated list
  const assigneeNames =
    session.assignments.length > 0
      ? session.assignments
          .map((a) => {
            const user = a.user;
            return resolveUserDisplayName(user) || user.email;
          })
          .join(", ")
      : "Not assigned";

  /**
   * One entry per asset somebody recorded something about, holding BOTH what
   * they wrote and what they photographed.
   *
   * why merged: a note about the Laerdal and a photo of the Laerdal are one
   * observation. Printing them in two separate sections made the reader join
   * them up by asset name across pages, which is work the receipt should have
   * done. Notes led that split badly — they had no section of their own at
   * all, and arrived mixed into a fifteen-row "Activity Log".
   */
  type Finding = {
    assetName: string;
    images: typeof assetImages;
    notes: typeof conditionNotes;
  };

  const findingGroups: Record<string, Finding> = {};

  const findingFor = (assetId: string, assetName: string) => {
    if (!findingGroups[assetId]) {
      findingGroups[assetId] = { assetName, images: [], notes: [] };
    }
    return findingGroups[assetId];
  };

  for (const img of assetImages) {
    const assetId = img.auditAsset?.asset?.id;
    if (!assetId) continue;
    findingFor(assetId, img.auditAsset?.asset?.title || "Unknown").images.push(
      img
    );
  }

  for (const note of conditionNotes) {
    const assetId = note.auditAsset?.asset?.id;
    // Audit-wide notes have no asset; they print above, with the general images.
    if (!assetId) continue;
    findingFor(assetId, note.auditAsset?.asset?.title || "Unknown").notes.push(
      note
    );
  }

  /** Notes about the audit as a whole — the completion note lives here. */
  const generalNotes = conditionNotes.filter((n) => !n.auditAsset?.asset?.id);

  const findingEntries = Object.entries(findingGroups).sort((a, b) =>
    a[1].assetName.localeCompare(b[1].assetName)
  );

  const hasFindings =
    findingEntries.length > 0 ||
    generalNotes.length > 0 ||
    generalImages.length > 0;

  return (
    <div
      // On screen the sheet is an A4 page with its 10mm margins as padding,
      // so the preview's table is the same 190mm wide as the printed one.
      className="pdf-wrapper mx-auto w-[210mm] bg-white p-[10mm] font-inter"
      ref={componentRef}
    >
      {/* Print-specific styles for A4 layout */}
      <style>
        {`@media print {
          @page {
            margin: 10mm;
            size: A4;
          }
          /* The printable width IS the sheet: A4 minus the page margins. A
             fixed width wider than that makes Chrome shrink the whole page. */
          .pdf-wrapper {
            margin: 0 !important;
            padding: 0 !important;
            width: auto !important;
            position: static !important;
            left: auto !important;
          }
          /* The cells draw every line. The table's own border would run
             down into the space a whole row leaves at the foot of a page. */
          .audit-assets-table {
            border: 0 !important;
            border-collapse: separate !important;
            border-spacing: 0 !important;
          }
          .audit-assets-table th,
          .audit-assets-table td {
            border-right: 1px solid #d1d5db !important;
            border-bottom: 1px solid #d1d5db !important;
          }
          .audit-assets-table thead th {
            border-top: 1px solid #d1d5db !important;
          }
          .audit-assets-table th:first-child,
          .audit-assets-table td:first-child {
            border-left: 1px solid #d1d5db !important;
          }
          /* A row never splits across a page break; the header repeats on
             every page. */
          .audit-assets-table tr {
            break-inside: avoid;
          }
          .audit-assets-table thead {
            display: table-header-group;
          }
        }`}
      </style>

      {/* Header Section */}
      <div className="mb-5 flex justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Image
              imageId={organization.imageId}
              alt="logo"
              className={tw("size-6 rounded-[2px] object-cover")}
              updatedAt={organization.updatedAt}
            />
            <h3 className="m-0 p-0 text-gray-600">{organization?.name}</h3>
          </div>
          <h1 className="mt-0.5 text-xl font-medium">
            Audit Receipt for {session?.name}
          </h1>
        </div>
        <div className="text-gray-500">
          {session.name} | <DateS date={new Date()} />
        </div>
      </div>

      {/* Audit Information Section - Key-value pairs */}
      <section className="mb-5 mt-2.5 border border-gray-300">
        <div className="flex border-b border-gray-300 p-2">
          <span className="min-w-[150px] text-sm font-medium">Audit Name</span>
          <span className="grow text-gray-600">{session?.name}</span>
        </div>
        <div className="flex border-b border-gray-300 p-2">
          <span className="min-w-[150px] text-sm font-medium">Status</span>
          <span className="grow text-gray-600">
            <AuditStatusBadgeWithOverdue
              status={session.status}
              dueDate={session.dueDate}
            />
          </span>
        </div>
        <div className="flex border-b border-gray-300 p-2">
          <span className="min-w-[150px] text-sm font-medium">Created by</span>
          <span className="grow text-gray-600">{creatorName}</span>
        </div>
        <div className="flex border-b border-gray-300 p-2">
          <span className="min-w-[150px] text-sm font-medium">Assigned to</span>
          <span className="grow text-gray-600">{assigneeNames}</span>
        </div>
        <div className="flex border-b border-gray-300 p-2">
          <span className="min-w-[150px] text-sm font-medium">Created</span>
          <span className="grow text-gray-600">
            {pdfMeta.from || <DateS date={session.createdAt} />}
          </span>
        </div>
        {/* Conditionally render optional date fields */}
        <When truthy={!!session.dueDate}>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Due date</span>
            <span className="grow text-gray-600">
              <DateS date={session.dueDate!} includeTime />
            </span>
          </div>
        </When>
        <When truthy={!!session.startedAt}>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Started</span>
            <span className="grow text-gray-600">
              <DateS date={session.startedAt!} includeTime />
            </span>
          </div>
        </When>
        <When truthy={!!session.completedAt}>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Completed</span>
            <span className="grow text-gray-600">
              {pdfMeta.to || <DateS date={session.completedAt!} includeTime />}
            </span>
          </div>
        </When>
        <When truthy={!!session.description}>
          <div className="flex p-2">
            <span className="min-w-[150px] text-sm font-medium">
              Description
            </span>
            <span className="grow whitespace-pre-wrap text-gray-600">
              {session?.description}
            </span>
          </div>
        </When>
      </section>

      {/* Statistics Section - Grid layout with counts */}
      <section className="mb-5">
        <h2 className="mb-2 text-lg font-medium">Statistics</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-gray-300 p-3 text-center">
            <div className="text-2xl font-bold">
              {session.expectedAssetCount}
            </div>
            <div className="text-sm text-gray-600">Expected</div>
          </div>
          <div className="border border-gray-300 p-3 text-center">
            <div className="text-2xl font-bold">
              {session.foundAssetCount ?? 0}
            </div>
            <div className="text-sm text-gray-600">
              {AUDIT_ASSET_STATUS_LABELS.FOUND}
            </div>
          </div>
          <div className="border border-gray-300 p-3 text-center">
            <div className="text-2xl font-bold">
              {session.missingAssetCount ?? 0}
            </div>
            <div className="text-sm text-gray-600">{unscannedLabel}</div>
          </div>
          <div className="border border-gray-300 p-3 text-center">
            <div className="text-2xl font-bold">
              {session.unexpectedAssetCount ?? 0}
            </div>
            <div className="text-sm text-gray-600">
              {AUDIT_ASSET_STATUS_LABELS.UNEXPECTED}
            </div>
          </div>
        </div>
      </section>

      {/*
        Findings — what people RECORDED, grouped by the asset they recorded it
        about, notes and photographs together.

        why this replaced the old "Images" section: a note and a photo of the
        same asset are one observation, and printing them apart made the reader
        rejoin them by name. Notes had it worse — no section at all, folded
        into a fifteen-row "Activity Log" that the system trail crowded out.
      */}
      <When truthy={hasFindings}>
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-medium">Findings</h2>

          {/* About the audit as a whole — completion note and its photos. */}
          <When truthy={generalNotes.length > 0 || generalImages.length > 0}>
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">About this audit</h3>

              {generalNotes.map((note) => (
                <div key={note.id} className="mb-2 border border-gray-300 p-2">
                  {/* why whitespace-pre-wrap: a condition note is typed in a
                      textarea, so line breaks are part of what the person
                      wrote. Without this the receipt runs a multi-line
                      observation together into one paragraph — the Activity
                      Log above already sets it for the same reason. */}
                  <p className="whitespace-pre-wrap text-xs text-gray-900">
                    {note.content}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {note.user
                      ? resolveUserDisplayName(note.user) || note.user.email
                      : "System"}{" "}
                    &middot; <DateS date={note.createdAt} includeTime />
                  </p>
                </div>
              ))}

              <When truthy={generalImages.length > 0}>
                <div className="grid grid-cols-4 gap-2">
                  {generalImages.map((img) => (
                    <div key={img.id} className="border border-gray-300 p-1">
                      <img
                        src={img.thumbnailUrl || img.imageUrl}
                        alt={img.description || "Audit image"}
                        className="h-24 w-full object-cover"
                      />
                      {img.description && (
                        <p className="mt-1 text-xs text-gray-600">
                          {img.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </When>
            </div>
          </When>

          {/* One block per asset somebody recorded something about. */}
          {findingEntries.map(([assetId, { assetName, images, notes }]) => (
            <div key={assetId} className="mb-3">
              <h4 className="mb-1 text-xs font-medium text-gray-700">
                {assetName}
              </h4>

              {notes.map((note) => (
                <div key={note.id} className="mb-2 border border-gray-300 p-2">
                  {/* why whitespace-pre-wrap: a condition note is typed in a
                      textarea, so line breaks are part of what the person
                      wrote. Without this the receipt runs a multi-line
                      observation together into one paragraph — the Activity
                      Log above already sets it for the same reason. */}
                  <p className="whitespace-pre-wrap text-xs text-gray-900">
                    {note.content}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {note.user
                      ? resolveUserDisplayName(note.user) || note.user.email
                      : "System"}{" "}
                    &middot; <DateS date={note.createdAt} includeTime />
                  </p>
                </div>
              ))}

              <When truthy={images.length > 0}>
                <div className="grid grid-cols-4 gap-2">
                  {images.map((img) => (
                    <div key={img.id} className="border border-gray-300 p-1">
                      <img
                        src={img.thumbnailUrl || img.imageUrl}
                        alt={img.description || `Photo of ${assetName}`}
                        className="h-24 w-full object-cover"
                      />
                      {img.description && (
                        <p className="mt-1 text-xs text-gray-600">
                          {img.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </When>
            </div>
          ))}
        </section>
      </When>

      {/* Assets Table - Detailed asset information */}
      <When truthy={assets.length > 0}>
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-medium">Assets</h2>
          <table className="audit-assets-table w-full table-fixed border border-gray-300">
            <colgroup>
              {ASSET_TABLE_COLUMNS.map((column) => (
                <col
                  key={column.name}
                  style={{ width: `${column.percent}%` }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="border border-gray-300 px-1 py-2.5 text-left text-xs font-medium">
                  #
                </th>
                <th className="border border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                  Image
                </th>
                <th className="border border-gray-300 p-2.5 text-left text-xs font-medium">
                  Name
                </th>
                <th className="border border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                  Category
                </th>
                <th className="border border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                  Location
                </th>
                <th className="border border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                  Status
                </th>
                {/* Wide enough for an 11-character Code 128 picture at 0.25mm
                    per bar, with the code text under it. */}
                <th className="border border-gray-300 p-2.5 text-left text-xs font-medium">
                  Code
                </th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset, index) => (
                <Fragment key={asset.id}>
                  <tr>
                    <td className="border border-gray-300 px-1 py-2.5 align-top text-xs">
                      {index + 1}
                    </td>
                    <td className="border border-gray-300 px-1.5 py-2.5 align-top">
                      <AssetPrintImage
                        asset={asset}
                        alt={asset.title}
                        className="size-12"
                      />
                    </td>
                    <td className="break-words border border-gray-300 p-2.5 align-top text-xs">
                      {asset.title}
                    </td>
                    <td className="border border-gray-300 px-1.5 py-2.5 align-top text-xs">
                      <CategoryBadge
                        category={asset.category ?? null}
                        className={WRAPPING_BADGE_CLASS}
                      />
                    </td>
                    <td className="border border-gray-300 px-1.5 py-2.5 align-top text-xs">
                      {asset.location?.name ? (
                        <GrayBadge className={WRAPPING_BADGE_CLASS}>
                          {asset.location.name}
                        </GrayBadge>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="border border-gray-300 px-1.5 py-2.5 align-top text-xs">
                      {/* Convert AuditAssetStatus to AuditStatusLabel for badge
                          display. Pass the audit's completion state so these
                          rows agree with the Statistics tile above them — the
                          two used to read "Not scanned" and "Missing" for the
                          same assets in the same PDF. */}
                      <AuditAssetStatusBadge
                        status={getAuditStatusLabel(
                          asset.auditData.auditStatus
                            ? (asset.auditData as {
                                expected: boolean;
                                auditStatus: AuditAssetStatus;
                              })
                            : null,
                          auditIsCompleted
                        )}
                      />
                    </td>
                    <td className="border border-gray-300 p-2.5 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <When truthy={showCodeImages}>
                          <AssetCodePrintImage
                            src={assetIdToCodeImageMap[asset.id]}
                            displayCode={assetIdToDisplayCodeMap[asset.id]}
                            alt={`Code for ${asset.title}`}
                            squareClassName="size-16"
                          />
                        </When>
                        {/* Printed even when there is no picture: the code is
                            the part a reader matches against the physical
                            label. */}
                        <AssetCodePrintText
                          displayCode={assetIdToDisplayCodeMap[asset.id]}
                        />
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      </When>

      {/* Activity Log - Recent notes and updates */}
      <When truthy={activityNotes.length > 0}>
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-medium">Activity Log</h2>
          <div className="border border-gray-300">
            {activityNotes.map((note, index) => {
              // Format user name from note data
              const userName = note.user
                ? resolveUserDisplayName(note.user) || note.user.email
                : "System";

              // Note content is already sanitized server-side to remove markdoc tags

              return (
                <div
                  key={note.id}
                  className={tw(
                    "flex gap-3 p-3",
                    index !== activityNotes.length - 1 &&
                      "border-b border-gray-300"
                  )}
                >
                  <div className="min-w-[140px] text-xs text-gray-500">
                    <DateS date={note.createdAt} includeTime />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs">
                      <span className="font-medium">{userName}</span>
                      <span className="ml-1 text-gray-600">{note.content}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </When>

      {/* Footer */}
      <div className="mt-8 border-t border-gray-300 pt-4 text-center text-xs text-gray-500">
        Generated on <DateS date={new Date()} /> | Powered by shelf.nu
      </div>
    </div>
  );
};
