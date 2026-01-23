import type React from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { AuditStatus, AuditAssetStatus } from "@prisma/client";
import { useReactToPrint } from "react-to-print";
import useApiQuery from "~/hooks/use-api-query";
import { getAuditStatusLabel } from "~/modules/audit/audit-filter-utils";
import type { AuditPdfDbResult } from "~/modules/audit/pdf-helpers";
import { sanitizeFilename } from "~/utils/sanitize-filename";
import { tw } from "~/utils/tw";
import { AuditAssetStatusBadge } from "./audit-asset-status-badge";
import { AuditStatusBadgeWithOverdue } from "./audit-status-badge-with-overdue";
import { CategoryBadge } from "../assets/category-badge";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";
import { GrayBadge } from "../shared/gray-badge";
import { Image } from "../shared/image";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

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
  const [isFetchingReceipt, setIsFetchingReceipt] = useState(false);

  // Configure print handler with sanitized filename
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `audit-receipt-${sanitizeFilename(
      audit.name
    )}-${Date.now()}`,
  });

  const { data, error } = useApiQuery<{ pdfMeta?: AuditPdfDbResult }>({
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

  useEffect(() => {
    if (open) {
      // Track loading state for dialog feedback while the query runs.
      setIsFetchingReceipt(true);
    } else {
      setPdfMeta(null);
      setIsFetchingReceipt(false);
    }
  }, [open]);

  useEffect(() => {
    if (data || error) {
      setIsFetchingReceipt(false);
    }
  }, [data, error]);

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={onClose}
        className="h-[90vh] w-full py-0 md:h-[calc(100vh-4rem)] md:w-[90%]"
        title={
          <div className="mx-auto w-full max-w-[210mm] border p-4 text-center">
            <h3>Generate audit receipt for "{audit.name}"</h3>
            <p>You can preview the receipt and then download the PDF.</p>
            {!isFetchingReceipt && (
              <div className="mt-4">
                <Button onClick={handlePrint}>Download PDF</Button>
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
            <Button variant="secondary" onClick={onClose}>
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
const AuditPDFContent = ({
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
    assetIdToQrCodeMap,
    generalImages,
    assetImages,
    activityNotes,
  } = pdfMeta;

  // Format creator name from user data or fallback to email
  const creatorName =
    session.createdBy?.firstName && session.createdBy?.lastName
      ? `${session.createdBy.firstName} ${session.createdBy.lastName}`
      : session.createdBy?.email || "Unknown";

  // Format assignee names as comma-separated list
  const assigneeNames =
    session.assignments.length > 0
      ? session.assignments
          .map((a) => {
            const user = a.user;
            return user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email;
          })
          .join(", ")
      : "None";

  // Group asset-specific images by their associated asset
  const assetImageGroups = assetImages.reduce(
    (acc, img) => {
      const assetId = img.auditAsset?.asset?.id;
      if (!assetId) return acc;

      if (!acc[assetId]) {
        acc[assetId] = {
          assetName: img.auditAsset?.asset?.title || "Unknown",
          images: [],
        };
      }
      acc[assetId].images.push(img);
      return acc;
    },
    {} as Record<string, { assetName: string; images: typeof assetImages }>
  );

  return (
    <div
      className="pdf-wrapper mx-auto w-[200mm] bg-white p-[10mm] font-inter"
      ref={componentRef}
    >
      {/* Print-specific styles for A4 layout */}
      <style>
        {`@media print {
          @page {
            margin: 10mm;
            size: A4;
          }
          .pdf-wrapper {
            margin: 0;
            padding: 0;
            position: static !important;
            left: auto !important;
          }
          .audit-assets-table {
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
        <When truthy={!!session.startedAt}>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Started</span>
            <span className="grow text-gray-600">
              <DateS
                date={session.startedAt!}
                options={{ dateStyle: "short", timeStyle: "short" }}
              />
            </span>
          </div>
        </When>
        <When truthy={!!session.dueDate}>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Due date</span>
            <span className="grow text-gray-600">
              <DateS
                date={session.dueDate!}
                options={{ dateStyle: "short", timeStyle: "short" }}
              />
            </span>
          </div>
        </When>
        <When truthy={!!session.completedAt}>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Completed</span>
            <span className="grow text-gray-600">
              {pdfMeta.to || (
                <DateS
                  date={session.completedAt!}
                  options={{ dateStyle: "short", timeStyle: "short" }}
                />
              )}
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
            <div className="text-sm text-gray-600">Found</div>
          </div>
          <div className="border border-gray-300 p-3 text-center">
            <div className="text-2xl font-bold">
              {session.missingAssetCount ?? 0}
            </div>
            <div className="text-sm text-gray-600">Missing</div>
          </div>
          <div className="border border-gray-300 p-3 text-center">
            <div className="text-2xl font-bold">
              {session.unexpectedAssetCount ?? 0}
            </div>
            <div className="text-sm text-gray-600">Unexpected</div>
          </div>
        </div>
      </section>

      {/* Images Section - General and asset-specific images */}
      <When truthy={generalImages.length > 0 || assetImages.length > 0}>
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-medium">Images</h2>

          {/* General Audit Images - Not linked to specific assets */}
          <When truthy={generalImages.length > 0}>
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                General Audit Images ({generalImages.length})
              </h3>
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
            </div>
          </When>

          {/* Asset-Specific Images - Grouped by asset */}
          <When truthy={assetImages.length > 0}>
            <div>
              <h3 className="mb-2 text-sm font-medium">
                Asset-Specific Images ({assetImages.length})
              </h3>
              {Object.entries(assetImageGroups).map(
                ([assetId, { assetName, images }]) => (
                  <div key={assetId} className="mb-3">
                    <h4 className="mb-1 text-xs font-medium text-gray-700">
                      {assetName}
                    </h4>
                    <div className="grid grid-cols-4 gap-2">
                      {images.map((img) => (
                        <div
                          key={img.id}
                          className="border border-gray-300 p-1"
                        >
                          <img
                            src={img.thumbnailUrl || img.imageUrl}
                            alt={img.description || "Asset image"}
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
                  </div>
                )
              )}
            </div>
          </When>
        </section>
      </When>

      {/* Assets Table - Detailed asset information */}
      <When truthy={assets.length > 0}>
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-medium">Assets</h2>
          <table className="audit-assets-table w-full border border-gray-300">
            <thead>
              <tr>
                <th className="w-10 border border-gray-300 p-2.5 text-left text-xs font-medium">
                  #
                </th>
                <th className="w-20 min-w-[76px] border border-gray-300 p-2.5 text-left text-xs font-medium">
                  Image
                </th>
                <th className="w-1/4 border border-gray-300 p-2.5 text-left text-xs font-medium">
                  Name
                </th>
                <th className="w-20 border border-gray-300 p-2.5 text-left text-xs font-medium">
                  Category
                </th>
                <th className="w-20 border border-gray-300 p-2.5 text-left text-xs font-medium">
                  Location
                </th>
                <th className="w-20 border border-gray-300 p-2.5 text-left text-xs font-medium">
                  Status
                </th>
                <th className="min-w-[80px] border border-gray-300 p-2.5 text-left text-xs font-medium">
                  QR Code
                </th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset, index) => (
                <Fragment key={asset.id}>
                  <tr>
                    <td className="border border-gray-300 p-2.5 align-top text-xs">
                      {index + 1}
                    </td>
                    <td className="border border-gray-300 p-2.5 align-top">
                      {/* Use simple img tag for PDF - AssetImage component doesn't work in print context */}
                      {asset.thumbnailImage ? (
                        <img
                          src={asset.thumbnailImage}
                          alt={asset.title}
                          className="size-12 rounded-[2px] object-cover"
                        />
                      ) : (
                        <div className="flex size-12 items-center justify-center rounded-[2px] bg-gray-100 text-xs text-gray-400">
                          No image
                        </div>
                      )}
                    </td>
                    <td className="border border-gray-300 p-2.5 align-top text-xs">
                      {asset.title}
                    </td>
                    <td className="border border-gray-300 p-2.5 align-top text-xs">
                      <CategoryBadge category={asset.category ?? null} />
                    </td>
                    <td className="border border-gray-300 p-2.5 align-top text-xs">
                      {asset.location?.name ? (
                        <GrayBadge>{asset.location.name}</GrayBadge>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="border border-gray-300 p-2.5 align-top text-xs">
                      {/* Convert AuditAssetStatus to AuditStatusLabel for badge display */}
                      <AuditAssetStatusBadge
                        status={getAuditStatusLabel(
                          asset.auditData.auditStatus
                            ? (asset.auditData as {
                                expected: boolean;
                                auditStatus: AuditAssetStatus;
                              })
                            : null
                        )}
                      />
                    </td>
                    <td className="border border-gray-300 p-2.5 align-top">
                      {assetIdToQrCodeMap[asset.id] && (
                        <img
                          src={assetIdToQrCodeMap[asset.id]}
                          alt={`QR code for ${asset.title}`}
                          className="size-16"
                        />
                      )}
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
                ? note.user.firstName && note.user.lastName
                  ? `${note.user.firstName} ${note.user.lastName}`
                  : note.user.email
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
                    <DateS
                      date={note.createdAt}
                      options={{ dateStyle: "short", timeStyle: "short" }}
                    />
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
