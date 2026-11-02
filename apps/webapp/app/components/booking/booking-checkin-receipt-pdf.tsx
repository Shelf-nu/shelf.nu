/**
 * Booking Check-in Receipt PDF
 *
 * The return-side twin of the booking checklist: one A4 sheet stating, per
 * booked item, whether it came back, when, in what state and who received it,
 * with totals, a completeness stamp and signature lines for the hand-over.
 *
 * Offered from the booking's Actions menu once anything has been checked in.
 * Unlike the checklist it carries no code pictures and no tick boxes (the sheet
 * is a record of what happened, not a list of work to do), and it prints no
 * asset values: it is handed to custodians and clients.
 *
 * @see {@link file://./../../routes/api+/bookings.$bookingId.generate-checkin-receipt.tsx}
 * @see {@link file://./../../modules/booking/checkin-receipt.ts}
 */

import type { ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import type { Booking } from "@prisma/client";
import { ReceiptTextIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import type {
  CheckinReceiptView,
  CheckinReceiptViewRow,
} from "~/modules/booking/checkin-receipt";
import { isCheckinReceiptAvailable } from "~/modules/booking/checkin-receipt-availability";
import { sanitizeFilename } from "~/utils/sanitize-filename";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import { BookingActionTrigger } from "./booking-action-trigger";
import type { BookingActionTriggerVariant } from "./booking-action-trigger";
import type { PdfAssetOrder } from "./booking-overview-pdf";
import { AssetCodePrintText } from "../assets/asset-code-print-text";
import { Dialog, DialogPortal } from "../layout/dialog";
import { DateS } from "../shared/date";
import { GrayBadge } from "../shared/gray-badge";
import { PrintColGroup, PrintTableStyles } from "../shared/print-table";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

// Re-exported so the receipt entry and its enabled rule import from one place.
export { isCheckinReceiptAvailable };

type CheckinReceiptApiResponse = { pdfMeta: CheckinReceiptView };

/**
 * Widths of the receipt table's columns, in percent, in column order. They sum
 * to 100 and the table is `table-fixed`, so the table is exactly the printable
 * width and no cell's content can push it off the page; long text wraps inside
 * its column instead.
 */
const RECEIPT_TABLE_COLUMNS = [
  { name: "number", percent: 6 },
  { name: "name", percent: 18 },
  { name: "quantity", percent: 7 },
  { name: "kit", percent: 12 },
  { name: "code", percent: 16 },
  { name: "returned", percent: 15 },
  { name: "checked-in-on", percent: 14 },
  { name: "checked-in-by", percent: 12 },
] as const;

/**
 * Why a booking has no receipt to print, for the disabled trigger's tooltip.
 *
 * @param bookingAssets - The booking's slices (only `checkedOutAt` is read)
 * @returns The reason shown when {@link isCheckinReceiptAvailable} is `false`
 */
export function checkinReceiptUnavailableReason(
  bookingAssets: Array<{ checkedOutAt: string | Date | null }>
): string {
  return bookingAssets.some((ba) => ba.checkedOutAt != null)
    ? "Nothing has been checked in yet."
    : "This booking was never checked out.";
}

/**
 * The entry that previews and prints a booking's check-in receipt, from the
 * booking page or a bookings list row.
 *
 * Rendered as a trigger plus a portalled dialog rather than a
 * `DropdownMenuItem`: selecting an item closes the menu, which would unmount
 * this component and the open dialog with it.
 *
 * @param props.booking - The booking to print
 * @param props.available - Whether the receipt can be generated. The caller
 *   decides: the booking page derives it with {@link isCheckinReceiptAvailable},
 *   the list reads the loader's `canPrintCheckinReceipt`.
 * @param props.unavailableReason - Shown on the disabled trigger; see
 *   {@link checkinReceiptUnavailableReason}
 * @param props.assetOrder - The sort to list rows in. Omitted, no sort is sent
 *   and the server default (status, descending) applies.
 * @param props.timeStamp - Stamped into the downloaded file's name so repeated
 *   prints of one booking do not overwrite each other.
 * @param props.trigger - Menu row (default) or icon button
 */
export const BookingCheckinReceiptPDF = ({
  booking,
  available,
  unavailableReason = "Nothing has been checked in yet.",
  assetOrder,
  timeStamp,
  trigger = "menu-item",
}: {
  booking: {
    id: Booking["id"];
    name: Booking["name"];
  };
  available: boolean;
  unavailableReason?: string;
  assetOrder?: PdfAssetOrder;
  timeStamp: number;
  trigger?: BookingActionTriggerVariant;
}) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const fetcher = useFetcher<CheckinReceiptApiResponse>();

  const pdfMeta = fetcher.data?.pdfMeta ?? null;
  const isFetchingReceipt = fetcher.state !== "idle" || pdfMeta === null;

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `checkin-receipt-${sanitizeFilename(
      booking.name
    )}-${timeStamp}`,
  });

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
    // Both values can come off the page's own query string unvalidated, so
    // they are encoded rather than interpolated: one carrying `&` or `#` would
    // otherwise rewrite or truncate the request.
    const query = new URLSearchParams(assetOrder ?? {});
    void fetcher.load(
      `/api/bookings/${booking.id}/generate-checkin-receipt?${query.toString()}`
    );
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };

  const disabled = !available && { reason: unavailableReason };

  return (
    <>
      {/* The menu row keeps its desktop-only look; the dialog is not built
          for a phone-width menu. */}
      <BookingActionTrigger
        variant={trigger}
        label="Generate check-in receipt"
        icon={<ReceiptTextIcon className="size-4" />}
        className={
          trigger === "menu-item" ? "hidden text-left md:block" : undefined
        }
        onClick={handleOpenDialog}
        disabled={disabled}
      />
      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={handleCloseDialog}
          className="h-dvh w-full md:h-[calc(100vh-4rem)] md:w-[90%] md:py-0"
          title={
            <div className="mx-auto w-full max-w-[210mm] border p-4 text-center">
              <h3>Generate check-in receipt for "{booking?.name}"</h3>
              <p>
                You can either preview or download the PDF. It lists every
                booked item and what came back.
              </p>
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
              ) : (
                <div className="overflow-x-auto">
                  <BookingCheckinReceiptPreview
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
      {trigger === "menu-item" && (
        <BookingActionTrigger
          variant="menu-item"
          label="Generate check-in receipt"
          icon={<ReceiptTextIcon className="size-4" />}
          className="block text-left md:hidden"
          disabled={disabled}
          onClick={handleOpenDialog}
        />
      )}
    </>
  );
};

/** One disposition count, tinted so the categories separate at a glance. */
function DispositionPill({
  tone,
  children,
}: {
  tone: "returned" | "consumed" | "lost" | "damaged" | "out";
  children: ReactNode;
}) {
  return (
    <span
      className={tw(
        // Wraps inside its narrow column rather than running past its edge.
        "inline-block max-w-full rounded-full px-2 py-px text-xs font-medium",
        tone === "returned" && "bg-success-50 text-success-700",
        tone === "consumed" && "bg-gray-100 text-gray-700",
        tone === "lost" && "bg-warning-50 text-warning-700",
        tone === "damaged" && "bg-error-50 text-error-700",
        tone === "out" && "bg-gray-100 text-gray-700"
      )}
    >
      {children}
    </span>
  );
}

/**
 * What the row's Returned cell states.
 *
 * The wording carries the meaning on its own: a monochrome printer drops the
 * tints above, and the sheet is read on paper.
 */
function ReturnedCell({ row }: { row: CheckinReceiptViewRow }) {
  if (row.state === "NEVER_CHECKED_OUT") {
    return <span className="text-gray-500">Never checked out</span>;
  }

  if (!row.isQuantityTracked) {
    return row.state === "RETURNED" ? (
      <DispositionPill tone="returned">Returned</DispositionPill>
    ) : (
      <DispositionPill tone="out">Still out</DispositionPill>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      <When truthy={row.returned > 0}>
        <DispositionPill tone="returned">
          {row.returned} returned
        </DispositionPill>
      </When>
      <When truthy={row.consumed > 0}>
        <DispositionPill tone="consumed">
          {row.consumed} consumed
        </DispositionPill>
      </When>
      <When truthy={row.lost > 0}>
        <DispositionPill tone="lost">{row.lost} lost</DispositionPill>
      </When>
      <When truthy={row.damaged > 0}>
        <DispositionPill tone="damaged">{row.damaged} damaged</DispositionPill>
      </When>
      <When truthy={row.stillOut > 0}>
        <DispositionPill tone="out">{row.stillOut} still out</DispositionPill>
      </When>
    </div>
  );
}

/** One labelled line of the sheet's key-value block. */
function ReceiptFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex border-b border-gray-300 p-2 last:border-b-0">
      <span className="min-w-[150px] text-sm font-medium">{label}</span>
      <span className="grow whitespace-pre-wrap text-gray-600">{children}</span>
    </div>
  );
}

/** One line of the totals ledger. */
function TotalsLine({
  label,
  value,
  isSum = false,
}: {
  label: string;
  value: number;
  isSum?: boolean;
}) {
  return (
    <>
      <span
        className={tw("text-gray-600", isSum && "font-semibold text-black")}
      >
        {label}
      </span>
      <span className={tw("text-right text-black", isSum && "font-semibold")}>
        {value}
      </span>
    </>
  );
}

/**
 * The printable body of the check-in receipt: the sheet `react-to-print` copies
 * to paper, and what the dialog shows as its preview.
 *
 * Exported so it can be rendered on its own. {@link BookingCheckinReceiptPDF},
 * the dialog around it, needs a router for the fetcher that loads `pdfMeta`.
 *
 * @param props.componentRef - Ref `react-to-print` prints from. Pass
 *   `{ current: null }` to render the sheet without printing it.
 * @param props.pdfMeta - Everything the sheet renders, as returned by the
 *   check-in receipt API. Renders nothing until it arrives.
 * @returns The receipt, or `null` while `pdfMeta` is still loading.
 */
export const BookingCheckinReceiptPreview = ({
  componentRef,
  pdfMeta,
}: {
  componentRef: RefObject<HTMLDivElement | null>;
  pdfMeta: CheckinReceiptView | null;
}) => {
  if (!pdfMeta) return null;

  const { booking, organization, rows, totals } = pdfMeta;

  // The same expression the checklist prints, so the two sheets never name the
  // custodian differently.
  const custodianName = booking.custodianUser
    ? `${resolveUserDisplayName(booking.custodianUser)} <${
        booking.custodianUser.email
      }>`
    : booking.custodianTeamMember?.name;

  // The sheet says "return" only where units actually came back. A booking
  // closed entirely through consumed, lost or damaged units was reconciled, not
  // returned, and a signature caption asking the custodian to attest a return
  // over a ledger reading zero returned is the same false claim the stamp used
  // to make.
  const anyReturned = totals.returned > 0;

  const plannedPeriod =
    pdfMeta.plannedFrom && pdfMeta.plannedTo
      ? `${pdfMeta.plannedFrom} - ${pdfMeta.plannedTo}`
      : "";

  return (
    <div className="border bg-gray-200 py-4">
      <PrintTableStyles tableClassName="checkin-receipt-table" />
      <div
        // On screen the sheet is an A4 page with its 10mm margins as padding,
        // so the preview's table is the same 190mm wide as the printed one.
        className="pdf-wrapper mx-auto w-[210mm] bg-white p-[10mm] font-inter"
        ref={componentRef}
      >
        <div className="mb-5 flex justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <When truthy={!!organization.imageId}>
                {/* Decorative: the workspace name sits beside it, so a
                    screen reader gains nothing from describing the mark. */}
                <Image
                  imageId={organization.imageId}
                  alt=""
                  className={tw("size-6 rounded-[2px] object-cover")}
                  updatedAt={organization.updatedAt}
                />
              </When>
              <h3 className="m-0 p-0 text-gray-600">{organization?.name}</h3>
            </div>
            <h1 className="mt-0.5 text-xl font-medium">
              Check-in receipt for {booking?.name}
            </h1>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {/* The only place on the sheet that states completeness. */}
            <span className="inline-block rounded-[3px] border-2 border-black px-2.5 py-1 font-mono text-xs font-medium uppercase tracking-[0.12em] text-black">
              {pdfMeta.stamp}
            </span>
            <div className="text-sm text-gray-500">
              Printed <DateS date={new Date()} />
            </div>
          </div>
        </div>

        <section className="mb-5 mt-2.5 border border-gray-300">
          <ReceiptFact label="Booking">{booking?.name}</ReceiptFact>
          <ReceiptFact label="Custodian">{custodianName}</ReceiptFact>
          <ReceiptFact label="Planned period">{plannedPeriod}</ReceiptFact>

          <When truthy={!!pdfMeta.checkedOutAt}>
            <ReceiptFact label="Checked out">
              {pdfMeta.checkedOutAt}
              <When truthy={!!pdfMeta.checkedOutByName}>
                {` by ${pdfMeta.checkedOutByName}`}
              </When>
            </ReceiptFact>
          </When>

          <When truthy={!!pdfMeta.returnedAt}>
            {/* The moment the booking closed. It is a return only when units
                actually came back: a booking whose every unit was written off
                as consumed, lost or damaged closed at this moment without
                anything being returned, and the row must not say otherwise. */}
            <ReceiptFact label={anyReturned ? "Returned" : "Accounted for"}>
              {pdfMeta.returnedAt}
              <When truthy={!!pdfMeta.latenessNote}>
                {" · "}
                <span
                  className={tw(
                    pdfMeta.latenessNote?.isLate && "font-medium text-error-600"
                  )}
                >
                  {pdfMeta.latenessNote?.text}
                </span>
              </When>
            </ReceiptFact>
          </When>

          <When truthy={pdfMeta.checkedInByNames.length > 0}>
            <ReceiptFact label="Checked in by">
              {pdfMeta.checkedInByNames.join(", ")}
            </ReceiptFact>
          </When>

          {/* One line when every returned row came back the same way; a
              mixed return says it per row instead. Nothing when no row
              recorded a method. */}
          <When truthy={!!pdfMeta.checkedInHow}>
            <ReceiptFact label="Check-in method">
              {pdfMeta.checkedInHow}
            </ReceiptFact>
          </When>

          <When truthy={!!booking.description}>
            <ReceiptFact label="Description">{booking.description}</ReceiptFact>
          </When>

          <When truthy={booking.tags.length > 0}>
            <div className="flex items-center border-b border-gray-300 p-2 last:border-b-0">
              <span className="min-w-[150px] text-sm font-medium">Tags</span>
              <div className="flex flex-wrap items-center gap-2">
                {booking.tags.map((tag) => (
                  <GrayBadge key={tag.id}>{tag.name}</GrayBadge>
                ))}
              </div>
            </div>
          </When>
        </section>

        <table className="checkin-receipt-table w-full table-fixed border border-gray-300">
          <PrintColGroup columns={RECEIPT_TABLE_COLUMNS} />
          <thead>
            <tr>
              <th className="border-b border-r border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                #
              </th>
              <th className="border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Name
              </th>
              <th className="border-b border-r border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                Qty
              </th>
              <th className="border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Kit
              </th>
              <th className="border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Code
              </th>
              <th className="border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium">
                Returned
              </th>
              <th className="border-b border-r border-gray-300 px-1.5 py-2.5 text-left text-xs font-medium">
                Checked in on
              </th>
              <th className="border-b border-gray-300 p-2.5 text-left text-xs font-medium">
                Checked in by
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // Per-slice rows: a quantity asset booked standalone + via
              // multiple kits appears once per slice, so key on the unique
              // `bookingAssetId`.
              <tr
                key={row.bookingAssetId}
                className="border-b border-gray-300 align-top"
              >
                <td className="border-r border-gray-300 px-1.5 py-2.5 text-sm text-gray-600">
                  {index + 1}
                </td>
                <td className="break-words border-r border-gray-300 p-2.5 text-sm text-gray-600">
                  {row.title}
                </td>
                <td className="break-words border-r border-gray-300 px-1.5 py-2.5 text-center text-sm tabular-nums text-gray-600">
                  {/* THIS slice's booked units; individual slices are qty 1. */}
                  {row.quantity}
                </td>
                <td className="break-words border-r border-gray-300 p-2.5 text-sm text-gray-600">
                  {row.kitName}
                  {/* Print-medium equivalent of the overview's "Removed from
                      kit" badge: without it a detached row is
                      indistinguishable from a live kit member. */}
                  <When truthy={row.isRemovedFromKit}>
                    <span className="mt-1 block text-xs text-gray-500">
                      Removed from kit, kept as a record of what was booked
                    </span>
                  </When>
                </td>
                <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                  <AssetCodePrintText displayCode={row.displayCode} />
                </td>
                <td className="border-r border-gray-300 p-2.5 text-sm text-gray-600">
                  <ReturnedCell row={row} />
                </td>
                {/* Wraps at the space between date and time: a full moment
                    in mono is wider than this column. */}
                <td className="break-words border-r border-gray-300 px-1.5 py-2.5 font-mono text-xs text-gray-600">
                  {row.checkedInOn}
                </td>
                <td className="break-words border-gray-300 p-2.5 text-sm text-gray-600">
                  {row.checkedInByName}
                  {/* The recorded method, per row, only when the header has
                      no shared line to carry it. */}
                  <When truthy={!pdfMeta.checkedInHow && !!row.checkedInHow}>
                    <span className="mt-1 block text-xs text-gray-500">
                      {row.checkedInHow}
                    </span>
                  </When>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Every line prints, zeros included: a zero is evidence that nothing
            was lost, and a missing line reads as a number nobody checked. */}
        <div className="ml-auto mt-3 grid w-[250px] grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 text-sm tabular-nums">
          <TotalsLine label="Items booked" value={totals.itemsBooked} />
          <TotalsLine label="Units sent out" value={totals.unitsSentOut} />
          <TotalsLine label="Returned" value={totals.returned} />
          <TotalsLine label="Consumed" value={totals.consumed} />
          <TotalsLine label="Lost" value={totals.lost} />
          <TotalsLine label="Damaged" value={totals.damaged} />
          <div className="col-span-2 my-1 border-t border-black" />
          <TotalsLine label="Still out" value={totals.stillOut} isSum />
        </div>

        <div className="mt-8 grid grid-cols-2 gap-6">
          <div className="border-t border-gray-400 pt-1.5 text-xs text-gray-600">
            {anyReturned
              ? "Returned by (custodian)"
              : "Confirmed by (custodian)"}{" "}
            · name, signature, date
          </div>
          <div className="border-t border-gray-400 pt-1.5 text-xs text-gray-600">
            {anyReturned ? "Received by" : "Recorded by"} · name, signature,
            date
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-400">
          Times are the recorded check-in moments, in the printing user's date
          format. Generated by Shelf.
        </div>
      </div>
    </div>
  );
};
