import type { ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import type { Booking } from "@prisma/client";
import { FileTextIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";

import { PDF_CODE_COLUMN_PERCENT } from "~/modules/barcode/pdf-code-image";
import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import type {
  BookingTemplateConfig,
  PdfTemplateSummary,
} from "~/modules/pdf-template/config";
import {
  BOOKING_CHECKLIST_CONFIG,
  printsAsColumn,
} from "~/modules/pdf-template/config";
import type { TemplateColumn } from "~/modules/pdf-template/rows";
import {
  groupTemplateRows,
  templateColumns,
} from "~/modules/pdf-template/rows";
import { getOutstandingModelRequests } from "~/utils/booking-model-requests";
import { truncateText } from "~/utils/truncate-text";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import { BookingActionTrigger } from "./booking-action-trigger";
import type { BookingActionTriggerVariant } from "./booking-action-trigger";
import type { BookingActionDisabled } from "./booking-actions";
import { AssetCodePrintImage } from "../assets/asset-code-print-image";
import { AssetCodePrintText } from "../assets/asset-code-print-text";
import { AssetPrintImage } from "../assets/asset-print-image";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Dialog, DialogPortal } from "../layout/dialog";
import { DateS } from "../shared/date";
import { GrayBadge } from "../shared/gray-badge";
import { PrintColGroup, PrintTableStyles } from "../shared/print-table";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

/** The saved PDF template a booking's PDF is laid out by. */
export type PdfTemplateForPdf = {
  id: string;
  name: string;
  config: BookingTemplateConfig;
};

type PdfApiResponse =
  | {
      pdfMeta: PdfDbResult;
      /** `null` when the workspace has no templates (it is not a team workspace). */
      template: PdfTemplateForPdf | null;
      templates: PdfTemplateSummary[];
      error: null;
    }
  | { pdfMeta?: undefined; error: { message: string } };

/**
 * The title printed on a booking's PDF, and its file name. A workspace without
 * PDF templates keeps the title the booking PDF has always had.
 *
 * @param templateName - The saved template's name, or `null` without one
 * @param bookingName - The booking's name
 */
export function bookingPdfTitle(
  templateName: string | null,
  bookingName: string
) {
  return templateName === null
    ? `Booking checklist for ${bookingName}`
    : `${templateName} - ${bookingName}`;
}

/**
 * The most description characters printed under each asset row. The booking
 * template is a hand-out, so a long description is cut instead of filling pages.
 */
const PDF_DESCRIPTION_MAX_LENGTH = 300;

/**
 * The sort a booking PDF lists its assets in: the `orderBy` and
 * `orderDirection` the generate routes read.
 */
export type PdfAssetOrder = { orderBy: string; orderDirection: string };

/**
 * Builds the {@link PdfAssetOrder} the booking page is showing, from its URL.
 *
 * The page's default `createdAt` order has no counterpart on the sheet, so it
 * (and a missing `orderBy`) becomes `status`; the direction defaults to `desc`.
 *
 * @param searchParams - The booking page's query string
 * @returns The order to hand to the PDF components
 */
export function pdfAssetOrderFromSearchParams(
  searchParams: URLSearchParams
): PdfAssetOrder {
  const rawOrderBy = searchParams.get("orderBy");
  return {
    orderBy: !rawOrderBy || rawOrderBy === "createdAt" ? "status" : rawOrderBy,
    orderDirection: searchParams.get("orderDirection") || "desc",
  };
}

/**
 * The entry that previews and prints a booking's template (its checklist or
 * other saved PDF template), from the booking page or a bookings list row.
 *
 * Rendered as a trigger plus a portalled dialog rather than a
 * `DropdownMenuItem`: selecting an item closes the menu, which would unmount
 * this component and the open dialog with it.
 *
 * @param props.booking - The booking to print
 * @param props.disabled - The trigger's disabled state, as the shared rules
 *   (`resolveBookingActions`, its `bookingDocument` entry) decide it
 * @param props.assetOrder - The sort to list assets in. Omitted, no sort is
 *   sent and the server default (status, descending) applies; the booking page
 *   passes the sort of its own URL.
 * @param props.trigger - Menu row (default) or icon button
 */
export const BookingOverviewPDF = ({
  booking,
  disabled,
  assetOrder,
  trigger = "menu-item",
}: {
  booking: {
    id: Booking["id"];
    name: Booking["name"];
  };
  disabled: BookingActionDisabled;
  assetOrder?: PdfAssetOrder;
  trigger?: BookingActionTriggerVariant;
}) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const fetcher = useFetcher<PdfApiResponse>({
    key: `booking-template-${booking.id}`,
  });

  const isIdle = fetcher.state === "idle";
  const response = fetcher.data?.pdfMeta ? fetcher.data : null;
  // A refused load (the picked template was deleted meanwhile, or the booking
  // cannot be read) is shown, with a way to load the templates again.
  const failure = isIdle && fetcher.data?.error ? fetcher.data.error : null;
  const isLoading = !isIdle || (response === null && failure === null);

  // The template list of the last load that answered, so a refused load leaves
  // the picker usable. Adjusted while rendering, React's pattern for state
  // derived from a changing value.
  const [templateList, setTemplateList] = useState<PdfTemplateSummary[]>([]);
  if (response && response.templates !== templateList)
    setTemplateList(response.templates);
  // The template just picked, shown in the picker before its load answers.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const shownTemplateId = pickedId ?? response?.template?.id ?? "";
  // A workspace with no templates (personal, on shelf.nu) gets no picker.
  const canChoose = templateList.length > 0;

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: response?.template
      ? bookingPdfTitle(response.template.name, booking.name)
      : `booking-${booking.name}-${Date.now()}`,
  });

  /**
   * Loads the template's data. With no `templateId` the server picks the person's
   * last template, or the workspace default, and says which in the response.
   */
  const loadTemplate = (templateId?: string) => {
    // A template sorted by status prints in the given order; a template
    // sorted by name ignores it. Without one the server's default applies.
    const params = new URLSearchParams(assetOrder ?? {});
    if (templateId) params.set("template", templateId);
    void fetcher.load(`/api/bookings/${booking.id}/generate-pdf?${params}`);
  };

  const handleOpenDialog = () => {
    setIsDialogOpen(true);
    setPickedId(null);
    loadTemplate();
  };

  const handlePickTemplate = (templateId: string) => {
    setPickedId(templateId);
    loadTemplate(templateId);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
  };
  return (
    <>
      {/* The menu row keeps its desktop-only look; the dialog is not built
          for a phone-width menu. */}
      <BookingActionTrigger
        variant={trigger}
        label="Generate PDF"
        icon={<FileTextIcon className="size-4" />}
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
              <h3>Generate PDF for {booking?.name}</h3>
              <When truthy={canChoose}>
                <div className="mx-auto mt-3 flex max-w-sm flex-col items-stretch gap-1 text-left">
                  <span
                    id={`template-picker-label-${booking.id}`}
                    className="text-sm font-medium text-gray-700"
                  >
                    Template
                  </span>
                  <Select
                    value={shownTemplateId}
                    onValueChange={handlePickTemplate}
                    disabled={!canChoose}
                  >
                    <SelectTrigger
                      aria-labelledby={`template-picker-label-${booking.id}`}
                    >
                      <SelectValue placeholder="Loading templates..." />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      className="w-[var(--radix-select-trigger-width)]"
                      align="start"
                    >
                      {templateList.map((item) => (
                        <SelectItem
                          key={item.id}
                          value={item.id}
                          className="p-2"
                        >
                          {item.name}
                          {item.isDefault ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    Owners and admins set up templates in Settings, Bookings.
                  </p>
                </div>
              </When>
              {!isLoading && response && (
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
              {isLoading ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <div>Generating PDF preview...</div>
                  <div>
                    <Spinner />
                  </div>
                </div>
              ) : failure || !response ? (
                <div
                  role="alert"
                  className="flex h-full flex-col items-center justify-center gap-3 text-center"
                >
                  <p className="text-gray-700">{failure?.message}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setPickedId(null);
                      loadTemplate();
                    }}
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <BookingPDFPreview
                    pdfMeta={response.pdfMeta}
                    pdfTemplate={response.template}
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
          label="Generate PDF"
          icon={<FileTextIcon className="size-4" />}
          className="block text-left md:hidden"
          disabled={disabled}
          onClick={handleOpenDialog}
        />
      )}
    </>
  );
};

type PdfAssetRow = PdfDbResult["assets"][number];

/** A header cell with the given horizontal padding. */
const th = (padding: string) =>
  `border-b border-r border-gray-300 ${padding} py-2.5 text-left text-xs font-medium`;

/** A body cell with the given horizontal padding; long text wraps. */
const wrappingTd = (padding: string) =>
  `break-words border-r border-gray-300 ${padding} py-2.5 text-sm text-gray-600`;

/**
 * How each column prints: its header text, its header cell's classes and its
 * body cell's classes. The cell's content comes from `renderCell`.
 */
const COLUMN_CELLS: Record<
  Exclude<TemplateColumn["kind"], "customField">,
  { header: string; th: string; td: string }
> = {
  number: {
    header: "#",
    th: th("px-1"),
    td: "border-r border-gray-300 px-1 py-2.5 text-sm text-gray-600",
  },
  image: {
    header: "Image",
    th: th("px-1.5"),
    td: "border-r border-gray-300 px-1.5 py-2.5 text-sm text-gray-600",
  },
  name: { header: "Name", th: th("px-2"), td: wrappingTd("px-2") },
  quantity: {
    header: "Qty",
    th: th("px-1"),
    td: "break-words border-r border-gray-300 px-1 py-2.5 text-center text-sm text-gray-600",
  },
  kit: { header: "Kit", th: th("px-2"), td: wrappingTd("px-2") },
  category: { header: "Category", th: th("px-2"), td: wrappingTd("px-2") },
  location: { header: "Location", th: th("px-2"), td: wrappingTd("px-2") },
  // Wide enough for the tick box and code line, and for an 11-character
  // Code 128 picture at 0.25mm per bar. The code text wraps on `break-all`.
  code: {
    header: "Code",
    th: "border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium",
    td: "border-r border-gray-300 p-2.5 text-sm text-gray-600",
  },
};

/**
 * A custom field column. Its values are short (an amount, a date, a serial
 * number) and its column is one of the narrowest, so it prints in the small
 * size with tighter padding to keep a value like "US$1,250.00" on one line.
 */
const CUSTOM_FIELD_CELL = {
  th: th("px-1.5"),
  td: "break-words border-r border-gray-300 px-1.5 py-2.5 text-xs text-gray-600",
};

function cellsOf(column: TemplateColumn) {
  return column.kind === "customField"
    ? CUSTOM_FIELD_CELL
    : COLUMN_CELLS[column.kind];
}

function columnKey(column: TemplateColumn) {
  return column.kind === "customField"
    ? `customField-${column.customFieldId}`
    : column.kind;
}

/**
 * The printable body of a booking template: the page `react-to-print` copies to
 * paper, and what the dialog shows as its preview. The template's config decides
 * which columns, rows and header lines print.
 *
 * Exported so it can be rendered on its own. {@link BookingOverviewPDF}, the
 * dialog around it, needs a router for the fetcher that loads `pdfMeta`.
 *
 * @param props.componentRef - Ref `react-to-print` prints from. Pass
 *   `{ current: null }` to render the template without printing it.
 * @param props.pdfMeta - Everything the template renders, as returned by
 *   `fetchAllPdfRelatedData`. Renders nothing until it arrives.
 * @param props.pdfTemplate - The saved template the page is laid out by, its
 *   name titling the page. `null` prints the built-in Checklist under the
 *   title the booking PDF has always had.
 * @returns The template, or `null` while `pdfMeta` is still loading.
 */
export const BookingPDFPreview = ({
  componentRef,
  pdfMeta,
  pdfTemplate,
}: {
  componentRef: RefObject<HTMLDivElement | null>;
  pdfMeta: PdfDbResult | null;
  pdfTemplate: Pick<PdfTemplateForPdf, "name" | "config"> | null;
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
    customFields,
  } = pdfMeta;
  const config = pdfTemplate?.config ?? BOOKING_CHECKLIST_CONFIG;

  // Workspaces that want people scanning the label on the item, not the template,
  // turn the code pictures off. The text code prints either way, so the row is
  // still matchable by eye.
  const showCodeImages = organization.showQrCodesOnPdfs ?? true;

  // Defensively re-filtered so a caller that feeds pre-computed `PdfDbResult`
  // with stale rows (a model request fulfilled concurrently) cannot print a
  // fulfilled row. `fulfilledAt IS NULL` is the canonical outstanding filter.
  const outstandingModelRequests = getOutstandingModelRequests(modelRequests);
  const custodianName = booking.custodianUser
    ? `${resolveUserDisplayName(booking.custodianUser)} <${
        booking.custodianUser.email
      }>`
    : booking.custodianTeamMember?.name;
  /** The custodian as named under the signature line, without the email. */
  const custodianSignatureName = booking.custodianUser
    ? resolveUserDisplayName(booking.custodianUser)
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
  const hasDescription =
    config.bookingDescription && !!booking.description?.trim();

  const columnFields = customFields.filter((field) =>
    printsAsColumn(field.type)
  );
  // A multi-line text prints in the description row, never as a column.
  const descriptionRowFields = config.assetDescription
    ? customFields.filter((field) => !printsAsColumn(field.type))
    : [];
  const columns = templateColumns({
    config,
    customFieldIds: columnFields.map((field) => field.id),
    codePercent: PDF_CODE_COLUMN_PERCENT,
  });
  const colGroup = columns.map((column) => ({
    name: columnKey(column),
    percent: column.percent,
  }));
  const groups = groupTemplateRows(assets, config.groupBy);
  const firstRowIndexOfGroup = groups.map((_, i) =>
    groups.slice(0, i).reduce((sum, g) => sum + g.rows.length, 0)
  );

  const renderCell = (
    column: TemplateColumn,
    asset: PdfAssetRow,
    index: number,
    codeImage: PdfDbResult["assetIdToCodeImageMap"][string] | undefined,
    printsCodeOnLine: boolean
  ): ReactNode => {
    switch (column.kind) {
      case "number":
        return index + 1;
      case "image":
        return (
          <AssetPrintImage
            asset={asset}
            alt={`Image of ${asset.title}`}
            className="size-14"
          />
        );
      case "name":
        return asset?.title;
      case "quantity":
        // THIS slice's booked units; INDIVIDUAL slices are qty 1.
        return asset.quantity ?? 1;
      case "kit":
        return (
          <>
            {/* The template prints the kit's name only. Kits carry no
                `sequentialId`, so a SAM_ID workspace has no kit code to
                print here. */}
            {asset?.kit?.name}
            {/* Print-medium equivalent of the overview's "Removed from kit"
                badge: a tooltip cannot exist on paper. Without it a detached
                row reads as a live kit member. Status-neutral wording:
                CANCELLED bookings keep these rows too and may never have
                gone out. */}
            <When truthy={!!asset.isRemovedFromKit}>
              <span className="mt-1 block text-xs text-gray-500">
                Removed from kit, kept as a record of what was booked
              </span>
            </When>
          </>
        );
      case "category":
        return asset?.category?.name;
      case "location":
        return asset?.location?.name;
      case "customField":
        // A field with no value prints an empty cell, to fill in by hand.
        return asset.customFieldValues?.[column.customFieldId] ?? null;
      case "code":
        return (
          <div className="flex flex-col items-start gap-1">
            {/* The picture is optional; the tick box and the code are not.
                Keeping the picture on its own line means the cell reads the
                same with it and without it, and gives the code the whole
                cell to wrap in. */}
            <When truthy={!printsCodeOnLine}>
              <AssetCodePrintImage
                image={codeImage}
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
              {/* Printed even when there is no picture: the code is the part
                  a picker matches against the physical label. */}
              <AssetCodePrintText
                displayCode={assetIdToDisplayCodeMap[asset.id]}
              />
            </div>
          </div>
        );
    }
  };

  return (
    <div className="border bg-gray-200 py-4">
      <PrintTableStyles tableClassName="booking-assets-table" />
      <div
        // On screen the template is an A4 page with its 10mm margins as padding,
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
              {bookingPdfTitle(pdfTemplate?.name ?? null, booking.name)}
            </h1>
          </div>
          <div className="text-gray-500">
            {booking.name} | <DateS date={new Date()} />
          </div>
        </div>

        <section
          className={tw(
            "mb-5 mt-2.5 border border-gray-300",
            // Without the total line, the last line is a bordered one and
            // would double the section's own border.
            !config.totalValue && "[&>div:last-child]:border-b-0"
          )}
        >
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

          <When truthy={config.totalValue}>
            <div className="flex p-2">
              <span className="min-w-[150px] text-sm font-medium">
                Total assets value
              </span>
              <span className="grow whitespace-pre-wrap text-gray-600">
                {totalValue}
              </span>
            </div>
          </When>

          <When truthy={booking.tags?.length > 0}>
            <div
              className={tw(
                "flex items-center border-t border-gray-300 p-2",
                !config.totalValue && "border-t-0"
              )}
            >
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
          <PrintColGroup columns={colGroup} />
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={columnKey(column)} className={cellsOf(column).th}>
                  {column.kind === "customField"
                    ? columnFields.find((f) => f.id === column.customFieldId)
                        ?.name
                    : COLUMN_CELLS[column.kind].header}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((group, groupIndex) =>
            group.rows.map((asset, rowInGroup) => {
              const index = firstRowIndexOfGroup[groupIndex] + rowInGroup;
              const codeImage = showCodeImages
                ? assetIdToCodeImageMap[asset.id]
                : undefined;
              // A code too wide or dense to scan inside the Code cell prints on
              // its own full-width line under the row instead.
              const printsCodeOnLine = codeImage?.placement === "line";
              const description = config.assetDescription
                ? asset.description
                : null;
              const longFields = descriptionRowFields.filter(
                (field) => asset.customFieldValues?.[field.id]
              );
              const hasDescriptionRow = !!description || longFields.length > 0;

              return (
                // One row group per asset, so its row, its code line and its
                // description row print on the same page. A group's header
                // rides in the group's first row group, so it never prints at
                // the foot of a page with no row under it. Per-slice rows: a
                // QT asset booked standalone + via multiple kits appears once
                // per slice, so key on the unique `bookingAssetId`.
                <tbody key={asset.bookingAssetId}>
                  <When truthy={group.name !== null && rowInGroup === 0}>
                    <tr className="border-b border-gray-300">
                      <td
                        colSpan={columns.length}
                        className="bg-gray-100 px-2 py-1.5 text-left text-sm font-medium text-gray-700"
                      >
                        {group.name} · {group.rows.length}
                      </td>
                    </tr>
                  </When>
                  <tr
                    className={tw(
                      "align-top",
                      !hasDescriptionRow &&
                        !printsCodeOnLine &&
                        "border-b border-gray-300"
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={columnKey(column)}
                        className={cellsOf(column).td}
                      >
                        {renderCell(
                          column,
                          asset,
                          index,
                          codeImage,
                          printsCodeOnLine
                        )}
                      </td>
                    ))}
                  </tr>

                  <When truthy={printsCodeOnLine}>
                    <tr
                      className={tw(
                        "align-top",
                        !hasDescriptionRow && "border-b border-gray-300"
                      )}
                    >
                      <td colSpan={columns.length} className="p-2.5 text-left">
                        <AssetCodePrintImage
                          image={codeImage}
                          alt={`Code of ${asset.title}`}
                          squareClassName="size-14"
                        />
                      </td>
                    </tr>
                  </When>

                  <When truthy={hasDescriptionRow}>
                    <tr className="border-b border-gray-300 align-top">
                      <td colSpan={columns.length} className="m-2 p-2">
                        <When truthy={!!description}>
                          <div className="flex items-start gap-4 bg-gray-100 p-4">
                            <div className="w-20 text-xs">
                              Asset Description
                            </div>
                            <div className="flex-1 text-sm">
                              {truncateText(
                                description ?? "",
                                PDF_DESCRIPTION_MAX_LENGTH
                              )}
                            </div>
                          </div>
                        </When>
                        {longFields.map((field, i) => (
                          <div
                            key={field.id}
                            className={tw(
                              "flex items-start gap-4 bg-gray-100 p-4",
                              (!!description || i > 0) && "mt-1"
                            )}
                          >
                            <div className="w-20 break-words text-xs">
                              {field.name}
                            </div>
                            <div className="flex-1 whitespace-pre-wrap text-sm">
                              {truncateText(
                                asset.customFieldValues[field.id],
                                PDF_DESCRIPTION_MAX_LENGTH
                              )}
                            </div>
                          </div>
                        ))}
                      </td>
                    </tr>
                  </When>
                </tbody>
              );
            })
          )}
        </table>

        {/*
         * Outstanding model-level reservations that have not yet been
         * fulfilled by a scan. Rendered after the concrete assets table in
         * natural reading order; omitted entirely (no heading) when the
         * booking has no active model requests.
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

        {/* Signed on paper, by hand. The lines leave room for a signature and
            the date; the custodian's name is printed so it does not have to
            be written. */}
        <When truthy={config.signatureLines}>
          <section
            aria-label="Signatures"
            className="mt-12 grid grid-cols-2 gap-10 [break-inside:avoid]"
          >
            <div>
              <div className="h-12 border-b border-gray-500" />
              <div className="mt-1 text-xs text-gray-600">
                Custodian signature · date
              </div>
              <div className="text-sm text-gray-900">
                {custodianSignatureName}
              </div>
            </div>
            <div>
              <div className="h-12 border-b border-gray-500" />
              <div className="mt-1 text-xs text-gray-600">Issued by · date</div>
            </div>
          </section>
        </When>
      </div>
    </div>
  );
};
