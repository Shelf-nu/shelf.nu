import type { RefObject } from "react";
import { Fragment, useRef, useState } from "react";
import type { Asset, Booking } from "@prisma/client";
import { useFetcher } from "react-router";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";

import { useSearchParams } from "~/hooks/search-params";
import { PDF_CODE_COLUMN_PERCENT } from "~/modules/barcode/pdf-code-image";
import { BOOKING_ASSET_SORTING_OPTIONS } from "~/modules/booking/constants";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import { getOutstandingModelRequests } from "~/utils/booking-model-requests";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import { AssetCodePrintImage } from "../assets/asset-code-print-image";
import { AssetCodePrintText } from "../assets/asset-code-print-text";
import { AssetPrintImage } from "../assets/asset-print-image";
import { Dialog, DialogPortal } from "../layout/dialog";
import { DateS } from "../shared/date";
import { GrayBadge } from "../shared/gray-badge";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

type PdfApiResponse = { pdfMeta: PdfDbResult };

/**
 * Widths of the asset table's columns, in percent, in column order. They sum
 * to 100 and the table is `table-fixed`, so the table is exactly the printable
 * width and no cell's content can push it off the page; long text wraps inside
 * its column instead. The Code column's share is shared with the server, which
 * refuses a barcode picture wider than that cell.
 */
const ASSET_TABLE_COLUMNS = [
  { name: "number", percent: 5 },
  { name: "image", percent: 10 },
  { name: "name", percent: 16 },
  { name: "quantity", percent: 6 },
  { name: "kit", percent: 10 },
  { name: "category", percent: 13 },
  { name: "location", percent: 13 },
  { name: "code", percent: PDF_CODE_COLUMN_PERCENT },
] as const;

export const BookingOverviewPDF = ({
  booking,
  timeStamp,
}: {
  booking: {
    id: Booking["id"];
    name: Booking["name"];
    assets: Array<
      Partial<Asset> & {
        /** Cover image of the asset's model, rendered when the asset has no
         * image of its own. See `~/modules/asset/image-resolution`. */
        assetModel?: {
          image: string | null;
          thumbnailImage: string | null;
        } | null;
      }
    >;
  };
  timeStamp: number;
}) => {
  const totalAssets = booking.assets.length;
  const componentRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const fetcher = useFetcher<PdfApiResponse>();
  const [searchParams] = useSearchParams();

  // Get sorting params from URL search params
  // Default to "status" since that's the default for booking assets
  const rawOrderBy = searchParams.get("orderBy");
  const orderBy =
    !rawOrderBy || rawOrderBy === "createdAt" ? "status" : rawOrderBy;
  const orderDirection = searchParams.get("orderDirection") || "desc";

  const pdfMeta = fetcher.data?.pdfMeta ?? null;
  const isFetchingBookings = fetcher.state !== "idle" || pdfMeta === null;

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `booking-${booking.name}-${timeStamp}`,
  });

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
    void fetcher.load(
      `/api/bookings/${booking.id}/generate-pdf?orderBy=${orderBy}&orderDirection=${orderDirection}`
    );
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };
  const disabled = !totalAssets && {
    reason: "No assets in booking to generate PDF overview.",
  };

  return (
    <>
      <Button
        type="button"
        variant="link"
        className="hidden justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700 md:block"
        width="full"
        name="generate pdf"
        onClick={handleOpenDialog}
        disabled={disabled}
      >
        Generate overview PDF
      </Button>
      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={handleCloseDialog}
          className="h-dvh w-full md:h-[calc(100vh-4rem)] md:w-[90%] md:py-0"
          title={
            <div className="mx-auto w-full max-w-[210mm] border p-4 text-center">
              <h3>Generate booking checklist for "{booking?.name}"</h3>
              <p>
                You can either preview or download the PDF. Assets are sorted by{" "}
                {BOOKING_ASSET_SORTING_OPTIONS[
                  orderBy as keyof typeof BOOKING_ASSET_SORTING_OPTIONS
                ] || BOOKING_ASSET_SORTING_OPTIONS.status}{" "}
                ({orderDirection === "asc" ? "ascending" : "descending"}).
              </p>
              {!isFetchingBookings && (
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
              {isFetchingBookings ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <div>Generating PDF preview...</div>
                  <div>
                    <Spinner />
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <BookingPDFPreview
                    pdfMeta={pdfMeta}
                    componentRef={componentRef}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={handleCloseDialog}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      </DialogPortal>

      {/* Only for mobile */}
      <Button
        type="button"
        variant="link"
        className="block justify-start rounded-sm px-2 py-1.5 text-left text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700  md:hidden"
        width="full"
        name="generate pdf"
        disabled={disabled}
        onClick={handleOpenDialog}
      >
        Generate overview PDF
      </Button>
    </>
  );
};

/**
 * The printable body of the booking checklist: the sheet `react-to-print`
 * copies to paper, and what the dialog shows as its preview.
 *
 * Exported so it can be rendered on its own. {@link BookingOverviewPDF}, the
 * dialog around it, needs a router for the fetcher that loads `pdfMeta`.
 *
 * @param props.componentRef - Ref `react-to-print` prints from. Pass
 *   `{ current: null }` to render the sheet without printing it.
 * @param props.pdfMeta - Everything the sheet renders, as returned by
 *   `fetchAllPdfRelatedData`. Renders nothing until it arrives.
 * @returns The checklist, or `null` while `pdfMeta` is still loading.
 */
export const BookingPDFPreview = ({
  componentRef,
  pdfMeta,
}: {
  componentRef: RefObject<HTMLDivElement | null>;
  pdfMeta: PdfDbResult | null;
}) => {
  if (!pdfMeta) return null;

  const {
    booking,
    organization,
    assets,
    assetIdToCodeImageMap,
    assetIdToDisplayCodeMap,
    totalValue,
    modelRequests,
  } = pdfMeta;

  // Workspaces that want people scanning the label on the item, not the sheet,
  // turn the code pictures off. The text code prints either way, so the row is
  // still matchable by eye.
  const showCodeImages = organization.showQrCodesOnPdfs ?? true;

  // Phase 3d (Book-by-Model): defensively re-filter here so a caller
  // that feeds pre-computed `PdfDbResult` with stale rows (e.g. after a
  // model request was fulfilled concurrently) can't leak a fulfilled
  // historical row into the printed PDF. `fulfilledAt IS NULL` is the
  // canonical outstanding filter.
  const outstandingModelRequests = getOutstandingModelRequests(modelRequests);
  const custodianName = booking.custodianUser
    ? `${resolveUserDisplayName(booking.custodianUser)} <${
        booking.custodianUser.email
      }>`
    : booking.custodianTeamMember?.name;

  /** Check if the `originalFrom` date is different from `from` date */
  const isFromDifferentFromOriginal =
    !!pdfMeta.originalFrom && pdfMeta.originalFrom !== pdfMeta.from;

  /** Check if the `originalTo` date is different from `to` date */
  const isToDifferentFromOriginal =
    !!pdfMeta.originalTo && pdfMeta.originalTo !== pdfMeta.to;

  const isPeriodDifferentFromOriginal =
    isFromDifferentFromOriginal || isToDifferentFromOriginal;

  /** An empty Description row is noise on paper, so it prints only with text. */
  const hasDescription = !!booking.description?.trim();

  return (
    <div className="border bg-gray-200 py-4">
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
          }
          .booking-assets-table {
            border-collapse: separate !important;
            border-spacing: 0 !important;
          }
          .booking-assets-table th,
          .booking-assets-table td {
            border-right: 1px solid #d1d5db !important;
            border-bottom: 1px solid #d1d5db !important;
          }
          .booking-assets-table thead th {
            border-top: 1px solid #d1d5db !important;
          }
          .booking-assets-table th:first-child,
          .booking-assets-table td:first-child {
            border-left: 1px solid #d1d5db !important;
          }
        }`}
      </style>
      <div
        // On screen the sheet is an A4 page with its 10mm margins as padding,
        // so the preview's table is the same 190mm wide as the printed one.
        className="pdf-wrapper mx-auto w-[210mm] bg-white p-[10mm] font-inter"
        ref={componentRef}
      >
        <div className="mb-5 flex justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Image
                imageId={organization.imageId}
                alt="img"
                className={tw("size-6 rounded-[2px] object-cover")}
                updatedAt={organization.updatedAt}
              />
              <h3 className="m-0 p-0 text-gray-600">{organization?.name}</h3>
            </div>
            <h1 className="mt-0.5 text-xl font-medium">
              Booking checklist for {booking?.name}
            </h1>
          </div>
          <div className="text-gray-500">
            {booking.name} | <DateS date={new Date()} />
          </div>
        </div>

        <section className="mb-5 mt-2.5 border border-gray-300">
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Booking</span>
            <span className="grow text-gray-600">{booking?.name}</span>
          </div>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">Custodian</span>
            <span className="grow text-gray-600">{custodianName}</span>
          </div>
          <div className="flex border-b border-gray-300 p-2">
            <span className="min-w-[150px] text-sm font-medium">
              Booking period
            </span>
            <span className="grow text-gray-600">
              {pdfMeta?.from && pdfMeta?.to
                ? `${pdfMeta.from} - ${pdfMeta.to}`
                : ""}
            </span>
          </div>

          {/* If from and to  */}
          <When truthy={isPeriodDifferentFromOriginal}>
            <div className="flex border-b border-gray-300 p-2">
              <span className="min-w-[150px] text-sm font-medium">
                Original period
              </span>
              <span className="grow text-gray-600">{`${
                isFromDifferentFromOriginal
                  ? pdfMeta.originalFrom
                  : pdfMeta.from
              } - ${
                isToDifferentFromOriginal ? pdfMeta.originalTo : pdfMeta.to
              }`}</span>
            </div>
          </When>

          <When truthy={hasDescription}>
            <div className="flex border-b border-gray-300 p-2">
              <span className="min-w-[150px] text-sm font-medium">
                Description
              </span>
              <span className="grow whitespace-pre-wrap text-gray-600">
                {booking.description}
              </span>
            </div>
          </When>

          <div className="flex p-2">
            <span className="min-w-[150px] text-sm font-medium">
              Total assets value
            </span>
            <span className="grow whitespace-pre-wrap text-gray-600">
              {totalValue}
            </span>
          </div>

          <When truthy={booking.tags?.length > 0}>
            <div className="flex items-center border-t border-gray-300 p-2">
              <span className="min-w-[150px] text-sm font-medium">Tags</span>

              <div className="flex flex-wrap items-center gap-2">
                {booking.tags.map((tag) => (
                  <GrayBadge key={tag.id}>{tag.name}</GrayBadge>
                ))}
              </div>
            </div>
          </When>
        </section>

        <table className="booking-assets-table w-full table-fixed border border-gray-300">
          <colgroup>
            {ASSET_TABLE_COLUMNS.map((column) => (
              <col key={column.name} style={{ width: `${column.percent}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="border-b border-r border-gray-300 px-1 py-2.5 text-left text-xs font-medium">
                #
              </th>
              <th className="border-b border-r border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                Image
              </th>
              <th className="border-b border-r border-gray-300 px-2 py-2.5 text-left text-xs font-medium">
                Name
              </th>
              <th className="border-b border-r border-gray-300 px-1 py-2.5 text-left text-xs font-medium">
                Qty
              </th>
              <th className="border-b border-r border-gray-300 px-2 py-2.5 text-left text-xs font-medium">
                Kit
              </th>
              <th className="border-b border-r border-gray-300 px-2 py-2.5 text-left text-xs font-medium">
                Category
              </th>
              <th className="border-b border-r border-gray-300 px-2 py-2.5 text-left text-xs font-medium">
                Location
              </th>
              {/* Wide enough for the tick box and code line, and for an
                  11-character Code 128 picture at 0.25mm per bar. The code
                  text wraps on `break-all`. */}
              <th className="border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Code
              </th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, index) => (
              // Per-slice rows: a QT asset booked standalone + via multiple
              // kits appears once per slice, so key on the unique
              // `bookingAssetId` (asset.id would collide across slices).
              <Fragment key={asset.bookingAssetId}>
                <tr
                  key={asset.bookingAssetId}
                  className={tw(
                    "align-top",
                    !asset.description && "border-b border-gray-300"
                  )}
                >
                  <td className="border-r border-gray-300 px-1 py-2.5 text-sm text-gray-600">
                    {index + 1}
                  </td>
                  <td className="border-r border-gray-300 px-1.5 py-2.5 text-sm text-gray-600">
                    <AssetPrintImage
                      asset={asset}
                      alt={`Image of ${asset.title}`}
                      className="size-14"
                    />
                  </td>
                  <td className="break-words border-r border-gray-300 px-2 py-2.5 text-sm text-gray-600">
                    {asset?.title}
                  </td>
                  <td className="break-words border-r border-gray-300 px-1 py-2.5 text-center text-sm text-gray-600">
                    {/* THIS slice's booked units; INDIVIDUAL slices are qty 1. */}
                    {asset.quantity ?? 1}
                  </td>
                  <td className="break-words border-r border-gray-300 px-2 py-2.5 text-sm text-gray-600">
                    {/* why: out of this rule — the checklist prints the kit's
                        name only. Kits carry no `sequentialId`, so a SAM_ID
                        workspace has no kit code to print here. */}
                    {asset?.kit?.name}
                    {/* Print-medium equivalent of the overview's
                        "Removed from kit" badge — a tooltip can't exist on
                        paper, so the explanation is printed inline. Without
                        it a detached row is indistinguishable from a live kit
                        member, and the kit's printed rows out-number the kit's
                        actual contents with nothing explaining the gap.
                        Status-neutral wording: CANCELLED bookings keep these
                        rows too and may never have gone out. */}
                    <When truthy={!!asset.isRemovedFromKit}>
                      <span className="mt-1 block text-xs text-gray-500">
                        Removed from kit — kept as a record of what was booked
                      </span>
                    </When>
                  </td>
                  <td className="break-words border-r border-gray-300 px-2 py-2.5 text-sm text-gray-600">
                    {asset?.category?.name}
                  </td>
                  <td className="break-words border-r border-gray-300 px-2 py-2.5 text-sm text-gray-600">
                    {asset?.location?.name}
                  </td>
                  <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                    <div className="flex flex-col items-start gap-1">
                      {/* The picture is optional; the tick box and the code are
                          not. Keeping the picture on its own line means the cell
                          reads the same with it and without it, and gives the
                          code the whole cell to wrap in. */}
                      <When truthy={showCodeImages}>
                        <AssetCodePrintImage
                          src={assetIdToCodeImageMap[asset.id]}
                          displayCode={assetIdToDisplayCodeMap[asset.id]}
                          alt={`Code of ${asset.title}`}
                          squareClassName="size-14"
                        />
                      </When>
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          aria-label={`Mark ${asset.title} as picked`}
                          className="block size-5 border"
                        />
                        {/* Printed even when there is no picture: the code is
                            the part a picker matches against the physical
                            label. */}
                        <AssetCodePrintText
                          displayCode={assetIdToDisplayCodeMap[asset.id]}
                        />
                      </div>
                    </div>
                  </td>
                </tr>

                <When truthy={!!asset.description}>
                  <tr className="border-b border-gray-300 align-top">
                    <td colSpan={8} className="m-2 p-2">
                      <div className="flex items-start gap-4 bg-gray-100 p-4">
                        <div className="w-20 text-xs">Asset Description</div>
                        <div className="flex-1 text-sm">
                          {asset.description}
                        </div>
                      </div>
                    </td>
                  </tr>
                </When>
              </Fragment>
            ))}
          </tbody>
        </table>

        {/*
         * Phase 3d (Book-by-Model): outstanding model-level reservations
         * that have not yet been fulfilled by a scan. Rendered after the
         * concrete assets table in natural reading order; omitted
         * entirely (no heading) when the booking has no active model
         * requests so PDFs for model-free bookings are unchanged.
         */}
        <When truthy={outstandingModelRequests.length > 0}>
          <section className="mt-5 border border-gray-300">
            <div className="border-b border-gray-300 bg-gray-50 p-2.5">
              <h2 className="m-0 text-sm font-medium">Requested models</h2>
            </div>
            <ul className="m-0 list-none p-0">
              {outstandingModelRequests.map((req) => (
                <li
                  key={req.id}
                  className="flex items-center gap-2 border-b border-gray-300 p-2.5 text-sm text-gray-600 last:border-b-0"
                >
                  <span className="font-medium text-gray-900">
                    {req.quantity - req.fulfilledQuantity} ×
                  </span>
                  <span>{req.assetModel.name}</span>
                </li>
              ))}
            </ul>
          </section>
        </When>
      </div>
    </div>
  );
};
