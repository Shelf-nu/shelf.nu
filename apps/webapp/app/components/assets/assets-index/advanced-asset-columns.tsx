import type { ReactNode } from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import type { AssetStatus, QrIdDisplayPreference } from "@prisma/client";
import { CustomFieldType } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { Link, useLoaderData } from "react-router";
import { EventCardContent } from "~/components/calendar/event-card";
import LineBreakText from "~/components/layout/line-break-text";
import { LocationBadge } from "~/components/location/location-badge";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/shared/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import When from "~/components/when/when";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";

import { useAssetIndexShowImage } from "~/hooks/use-asset-index-show-image";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";

import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type {
  AdvancedIndexAsset,
  ShelfAssetCustomFieldValueType,
} from "~/modules/asset/types";
import { isQuantityTracked } from "~/modules/asset/utils";
import type {
  ColumnLabelKey,
  BarcodeField,
} from "~/modules/asset-index-settings/helpers";
import { formatCustodyList } from "~/modules/custody/utils";
import { type AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { formatAssetValueWithBreakdown } from "~/utils/asset-value";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { formatCurrency } from "~/utils/currency";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { cleanMarkdownFormatting } from "~/utils/markdown-cleaner";
import { isLink } from "~/utils/misc";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { resolveUserDisplayName } from "~/utils/user";
import { AssetCodeBadge } from "../asset-code-badge";
import { QrIdCell } from "./advanced-columns/qr-id-cell";
import { SamIdCell } from "./advanced-columns/sam-id-cell";
import { Td } from "./advanced-columns/td";
import AssetQuickActions from "./asset-quick-actions";
import { freezeColumnClassNames } from "./freeze-column-classes";
import { ListItemTagsColumn } from "./list-item-tags-column";
import { CodePreviewDialog } from "../../code-preview/code-preview-dialog";
import { AssetImage } from "../asset-image/component";
import { AssetStatusBadge } from "../asset-status-badge";
import { CategoryBadge } from "../category-badge";

export function AdvancedIndexColumn({
  column,
  item,
}: {
  column: ColumnLabelKey;
  item: AdvancedIndexAsset;
}) {
  const { locale, currentOrganization } = useLoaderData<AssetIndexLoaderData>();
  const { prefs } = useDateFormatter();
  const showAssetImage = useAssetIndexShowImage();
  const freezeColumn = useAssetIndexFreezeColumn();
  const { modeIsAdvanced } = useAssetIndexViewState();
  const isCustomField = column.startsWith("cf_");

  if (isCustomField) {
    const fieldName = column.replace("cf_", "");
    const field = item.customFields?.find(
      (customFieldValue) => customFieldValue.customField.name === fieldName
    );

    const fieldValue =
      field?.value as unknown as ShelfAssetCustomFieldValueType["value"];

    if (!field) {
      return (
        <Td>
          <EmptyTableValue />
        </Td>
      );
    }

    const customFieldDisplayValue = getCustomFieldDisplayValue(
      fieldValue,
      prefs
    );

    return (
      <Td>
        {field.customField.type === CustomFieldType.MULTILINE_TEXT ? (
          <Popover>
            <PopoverTrigger className="underline hover:cursor-pointer">
              View content
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent
                align="end"
                className={tw(
                  "z-[999999] mt-1 min-w-[300px] rounded-md border border-gray-300 bg-white p-4"
                )}
              >
                <MarkdownViewer
                  content={customFieldDisplayValue as RenderableTreeNode}
                />
              </PopoverContent>
            </PopoverPortal>
          </Popover>
        ) : isLink(customFieldDisplayValue as string) ? (
          <Button
            role="link"
            variant="link"
            className="text-gray text-end font-normal underline hover:text-gray-600"
            target="_blank"
            to={`${customFieldDisplayValue}?ref=shelf-webapp`}
          >
            {customFieldDisplayValue as string}
          </Button>
        ) : field.customField.type === CustomFieldType.AMOUNT ? (
          formatCurrency({
            value: fieldValue.raw as number,
            locale,
            currency: currentOrganization.currency,
          })
        ) : (
          (customFieldDisplayValue as string)
        )}
      </Td>
    );
  }
  switch (column) {
    case "name":
      return (
        <TextColumn
          className={tw(
            "min-w-[300px] max-w-[450px] whitespace-normal",
            modeIsAdvanced && freezeColumn ? freezeColumnClassNames.name : ""
          )}
          value={
            <div className="flex items-center gap-2">
              {showAssetImage ? (
                <AssetImage
                  asset={{
                    id: item.id,
                    mainImage: item.mainImage,
                    thumbnailImage: item.thumbnailImage,
                    mainImageExpiration: item.mainImageExpiration,
                  }}
                  alt={`Image of ${item.title}`}
                  className="size-10 shrink-0 rounded-[4px] border object-cover"
                  withPreview={true}
                />
              ) : null}

              <div className="min-w-0 flex-1 truncate">
                <div className="flex items-center gap-1.5">
                  <Link
                    to={item.id}
                    className="truncate font-medium underline hover:text-gray-600"
                    title={item.title}
                  >
                    {item.title}
                  </Link>
                  {isQuantityTracked(item) ? (
                    <span className="inline-flex shrink-0 items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                      QTY
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          }
        />
      );

    case "id":
      // Asset CUID — internal/developer identifier. Stays plain text on purpose;
      // not part of the "customer-facing identifier family" (qrId / sequentialId).
      return <TextColumn value={item[column]} />;

    case "sequentialId":
      return (
        <SamIdCell
          item={item}
          workspacePreference={currentOrganization.qrIdDisplayPreference}
        />
      );

    case "qrId":
      return (
        <QrIdCell
          item={item}
          workspacePreference={currentOrganization.qrIdDisplayPreference}
        />
      );

    case "status":
      return (
        <StatusColumn
          id={item.id}
          status={item.status}
          availableToBook={item.availableToBook}
          asset={item}
        />
      );

    case "description":
      return <DescriptionColumn value={item.description ?? ""} />;

    case "valuation": {
      // Quantity-aware: render TOTAL (valuation × quantity) on top, with a
      // small "<unit price> × N <unit>" subtext for QT assets whose total
      // differs from the per-unit price. INDIVIDUAL assets and QT with
      // quantity ≤ 1 collapse to a single line — visually unchanged from
      // the legacy behaviour. See {@link formatAssetValueWithBreakdown}.
      if (item?.valuation == null) {
        return (
          <Td className="w-full max-w-none whitespace-nowrap">
            <EmptyTableValue />
          </Td>
        );
      }

      const breakdown = formatAssetValueWithBreakdown(item, {
        currency: currentOrganization.currency,
        locale,
      });

      return (
        <Td className="w-full max-w-none whitespace-nowrap">
          {breakdown.unit && breakdown.suffix ? (
            <div className="flex flex-col leading-tight">
              <span className="tabular-nums">{breakdown.total}</span>
              <span className="text-xs tabular-nums text-gray-500">
                {breakdown.unit} {breakdown.suffix}
              </span>
            </div>
          ) : (
            <span className="tabular-nums">{breakdown.total}</span>
          )}
        </Td>
      );
    }
    case "createdAt":
      return <DateColumn value={item.createdAt} includeTime />;

    case "updatedAt":
      return <DateColumn value={item.updatedAt} includeTime />;

    case "category":
      return <CategoryColumn category={item.category} />;

    case "tags":
      return <TagsColumn tags={item.tags} />;

    case "location":
      return <LocationColumn locations={item.locations} />;

    case "kit":
      return <KitColumn kits={item.kits} />;

    case "custody":
      return <CustodyColumn custody={item.custody} />;

    case "availableToBook":
      return <TextColumn value={item.availableToBook ? "Yes" : "No"} />;

    case "upcomingReminder":
      return (
        <UpcomingReminderColumn
          assetId={item.id}
          upcomingReminder={item.upcomingReminder}
        />
      );

    case "actions":
      return (
        <Td>
          <AssetQuickActions asset={item} />
        </Td>
      );

    case "barcode_Code128":
    case "barcode_Code39":
    case "barcode_DataMatrix":
    case "barcode_ExternalQR":
    case "barcode_EAN13":
      return (
        <BarcodeColumn
          column={column}
          item={item}
          workspacePreference={currentOrganization.qrIdDisplayPreference}
        />
      );

    case "type":
      return (
        <Td className="w-full max-w-none whitespace-nowrap">
          {isQuantityTracked(item) ? (
            <span className="inline-flex shrink-0 items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
              QTY
            </span>
          ) : (
            "Individual"
          )}
        </Td>
      );

    case "assetModel":
      return (
        <Td className="w-full max-w-none whitespace-nowrap">
          {item.assetModelName ? item.assetModelName : <EmptyTableValue />}
        </Td>
      );

    case "quantity":
      return (
        <Td className="w-full max-w-none whitespace-nowrap">
          {isQuantityTracked(item) && item.quantity != null ? (
            `${item.quantity}${
              item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ""
            }`
          ) : (
            <EmptyTableValue />
          )}
        </Td>
      );

    case "upcomingBookings":
      return <UpcomingBookingsColumn bookings={item.bookings} />;

    default:
      return (
        <Td>
          <EmptyTableValue />
        </Td>
      );
  }
}

function TextColumn({
  value,
  className,
  ...rest
}: {
  value: string | ReactNode;
  className?: string;
}) {
  return (
    <Td
      className={tw(
        "w-full max-w-none !overflow-visible whitespace-nowrap",
        className
      )}
      {...rest}
    >
      {/* Only show tooltip when value is more than 60 - 2 rows of 30 */}
      {typeof value === "string" && value.length > 60 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="text-left">
              {value.slice(0, 60)}...
            </TooltipTrigger>

            <TooltipContent side="top" className="max-w-[400px]">
              <p className="text-sm">{value}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span>{value}</span>
      )}
    </Td>
  );
}

function StatusColumn({
  id,
  status,
  availableToBook,
  asset,
}: {
  id: string;
  status: AssetStatus;
  availableToBook?: boolean;
  asset?: AdvancedIndexAsset;
}) {
  return (
    <Td className="w-full max-w-none whitespace-nowrap">
      <AssetStatusBadge
        id={id}
        status={status}
        availableToBook={availableToBook ?? true}
        asset={asset}
      />
    </Td>
  );
}

/**
 * Displays a truncated plain-text preview of the asset description and shows
 * the full markdown-rendered content inside a tooltip on hover.
 * Description column component - exported for reuse in other index pages
 */
export function DescriptionColumn({ value }: { value: string }) {
  const plainPreview = cleanMarkdownFormatting(value ?? "");
  const hasContent = Boolean(value && value.trim().length > 0);
  const previewText = plainPreview.length > 0 ? plainPreview : value.trim();

  return (
    <Td className="max-w-62 min-w-60 whitespace-pre-wrap">
      {!hasContent ? (
        <EmptyTableValue />
      ) : (plainPreview || value).length > 60 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="text-left">
              <LineBreakText text={previewText} charactersPerLine={28} />
            </TooltipTrigger>

            <TooltipContent side="top" className="max-w-[400px]">
              <h5>Asset description</h5>
              <MarkdownViewer content={value} className="mt-2 text-sm" />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span>{previewText}</span>
      )}
    </Td>
  );
}

/**
 * Renders a compact date cell with optional time information.
 */
function DateColumn({
  value,
  includeTime = false,
}: {
  value: string | Date;
  includeTime?: boolean;
}) {
  return (
    <Td className="w-full max-w-none whitespace-nowrap">
      <DateS date={value} includeTime={includeTime} />
    </Td>
  );
}

function CategoryColumn({
  category,
}: {
  category: AdvancedIndexAsset["category"];
}) {
  return (
    <Td className="w-full max-w-none whitespace-nowrap">
      <CategoryBadge category={category} />
    </Td>
  );
}

function TagsColumn({ tags }: { tags: AdvancedIndexAsset["tags"] }) {
  return (
    <Td className="text-left">
      <ListItemTagsColumn tags={tags} />
    </Td>
  );
}

/**
 * Renders the custody column for the advanced asset index.
 *
 * Single custodian: renders just the badge (with `(qty)` suffix when
 * the custody row tracks more than one unit, hiding the suffix on
 * INDIVIDUAL assets to keep the row clean).
 *
 * Multiple custodians: renders the primary custodian's badge plus a
 * `+N more` chip; hovering the chip reveals a tooltip listing every
 * custodian on its own line so the full custody breakdown stays one
 * hover away without inflating row height.
 */
export function CustodyColumn({
  custody,
}: {
  custody: AdvancedIndexAsset["custody"];
}) {
  const { roles } = useUserRoleHelper();
  const { primary, others, total } = formatCustodyList(custody ?? []);

  return (
    <When
      truthy={userHasPermission({
        roles,
        entity: PermissionEntity.custody,
        action: PermissionAction.read,
      })}
    >
      <Td>
        {!primary || total === 0 ? (
          <EmptyTableValue />
        ) : (
          <CustodyColumnContent primary={primary} others={others} />
        )}
      </Td>
    </When>
  );
}

/** Quantity suffix is intentionally omitted for `quantity <= 1` so
 * INDIVIDUAL assets and qty-tracked rows that hold a single unit stay
 * visually identical to today's rendering. */
function CustodyQuantitySuffix({ quantity }: { quantity?: number }) {
  if (!quantity || quantity <= 1) return null;
  return <span className="ml-1 text-gray-500">({quantity})</span>;
}

/** Renders the badge + optional `+N more` chip. Split out so the empty
 * state can short-circuit before the tooltip provider mounts. */
function CustodyColumnContent({
  primary,
  others,
}: {
  primary: NonNullable<AdvancedIndexAsset["custody"]>[number];
  others: NonNullable<AdvancedIndexAsset["custody"]>[number][];
}) {
  const hasOthers = others.length > 0;

  const primaryBadge = (
    <span className="inline-flex min-w-0 items-center">
      <TeamMemberBadge teamMember={primary.custodian} />
      <CustodyQuantitySuffix quantity={primary.quantity} />
    </span>
  );

  if (!hasOthers) {
    return primaryBadge;
  }

  return (
    <span className="flex min-w-0 items-center gap-x-1.5 whitespace-nowrap">
      {primaryBadge}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="shrink-0 cursor-help whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
              data-testid="custody-more-chip"
            >
              +{others.length} more
            </span>
          </TooltipTrigger>
          <TooltipContent
            className="max-w-xs"
            data-testid="custody-more-tooltip"
          >
            <ul className="flex flex-col gap-1 text-sm">
              {[primary, ...others].map((entry) => {
                const name = entry.custodian?.name ?? entry.name ?? "Unknown";
                const qty = entry.quantity;
                // why: Custody rows carry their own `id`; the upstream
                // `formatCustodyList` type is generic, so we cast to read
                // it and fall back to a name+qty composite if missing.
                const key = (entry as { id?: string }).id ?? `${name}-${qty}`;
                return (
                  <li key={key}>
                    {name}
                    {qty && qty > 1 ? ` (${qty})` : null}
                  </li>
                );
              })}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

/**
 * Renders the kit column for the advanced asset index.
 *
 * Single kit: renders the primary kit name as a link to the kit page.
 * Multiple kits (qty-tracked split across kits): renders the primary
 * kit link plus a "+N more" chip; hovering the chip reveals a tooltip
 * listing every kit name on its own line. Mirrors `CustodyColumn` so
 * the asset-index never silently hides kit membership 2..N.
 */
export function KitColumn({ kits }: { kits: AdvancedIndexAsset["kits"] }) {
  const { primary, others } = formatCustodyList(kits);

  return (
    <Td>
      {!primary ? (
        <EmptyTableValue />
      ) : (
        <KitColumnContent primary={primary} others={others} />
      )}
    </Td>
  );
}

function KitColumnContent({
  primary,
  others,
}: {
  primary: AdvancedIndexAsset["kits"][number];
  others: AdvancedIndexAsset["kits"][number][];
}) {
  const hasOthers = others.length > 0;

  const primaryLink = (
    <Link
      to={`/kits/${primary.id}`}
      className="block max-w-[220px] truncate font-medium underline hover:text-gray-600"
      title={primary.name}
    >
      {primary.name}
    </Link>
  );

  if (!hasOthers) {
    return primaryLink;
  }

  return (
    <span className="flex min-w-0 items-center gap-x-1.5 whitespace-nowrap">
      {primaryLink}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="shrink-0 cursor-help whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
              data-testid="kit-more-chip"
            >
              +{others.length} more
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs" data-testid="kit-more-tooltip">
            <ul className="flex flex-col gap-1 text-sm">
              {[primary, ...others].map((entry) => (
                <li key={entry.id}>{entry.name}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

/**
 * Renders the location column for the advanced asset index.
 *
 * Single location: renders the primary placement as a LocationBadge
 * wrapped in a link to the location page.
 * Multiple locations (qty-tracked split across locations): renders the
 * primary location plus a "+N more" chip with a hover tooltip listing
 * every location. Mirror of `KitColumn` / `CustodyColumn`.
 */
export function LocationColumn({
  locations,
}: {
  locations: AdvancedIndexAsset["locations"];
}) {
  const { primary, others } = formatCustodyList(locations);

  return (
    <Td>
      {!primary ? (
        <EmptyTableValue />
      ) : (
        <LocationColumnContent primary={primary} others={others} />
      )}
    </Td>
  );
}

function LocationColumnContent({
  primary,
  others,
}: {
  primary: AdvancedIndexAsset["locations"][number];
  others: AdvancedIndexAsset["locations"][number][];
}) {
  const hasOthers = others.length > 0;

  const primaryButton = (
    <Button
      to={`/locations/${primary.id}`}
      variant="inherit"
      className="hover:no-underline"
    >
      <LocationBadge
        location={{
          id: primary.id,
          name: primary.name,
          parentId: primary.parentId ?? undefined,
          childCount: primary.childCount ?? 0,
        }}
      />
    </Button>
  );

  if (!hasOthers) {
    return primaryButton;
  }

  return (
    <span className="flex min-w-0 items-center gap-x-1.5 whitespace-nowrap">
      {primaryButton}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="shrink-0 cursor-help whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
              data-testid="location-more-chip"
            >
              +{others.length} more
            </span>
          </TooltipTrigger>
          <TooltipContent
            className="max-w-xs"
            data-testid="location-more-tooltip"
          >
            <ul className="flex flex-col gap-1 text-sm">
              {[primary, ...others].map((entry) => (
                <li key={entry.id}>{entry.name}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

function UpcomingReminderColumn({
  assetId,
  upcomingReminder,
}: {
  assetId: string;
  upcomingReminder: AdvancedIndexAsset["upcomingReminder"];
}) {
  if (!upcomingReminder) {
    return <Td>No upcoming reminder</Td>;
  }

  return (
    <Td>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="link-gray" to={`/assets/${assetId}/reminders`}>
            <DateS date={upcomingReminder.alertDateTime} includeTime />
          </Button>
        </TooltipTrigger>

        <TooltipContent className="max-w-[400px]">
          <p className="mb-1 font-bold">{upcomingReminder.name}</p>
          <p>{upcomingReminder.message.substring(0, 1000)}</p>
        </TooltipContent>
      </Tooltip>
    </Td>
  );
}

function BarcodeColumn({
  column,
  item,
  workspacePreference,
}: {
  column: BarcodeField;
  item: AdvancedIndexAsset;
  workspacePreference: QrIdDisplayPreference;
}) {
  // Map column names to actual enum values
  const typeMapping: Record<string, string> = {
    Code128: "Code128",
    Code39: "Code39",
    DataMatrix: "DataMatrix",
    ExternalQR: "ExternalQR",
    EAN13: "EAN13",
  };

  const columnType = column.split("_")[1];
  const actualBarcodeType = typeMapping[columnType] || columnType;

  const barcodes =
    item.barcodes?.filter((b) => b.type === actualBarcodeType) || [];

  if (barcodes.length === 0) {
    return (
      <Td>
        <EmptyTableValue />
      </Td>
    );
  }

  // If only one barcode, show as a single clickable chip — same visual
  // language as the qrId column: AssetCodeBadge inside a button so the
  // CodePreviewDialog still opens on click, with hover/focus affordances
  // and the trailing "expand" glyph (`interactive`) signaling clickability.
  if (barcodes.length === 1) {
    const barcode = barcodes[0];
    return (
      <CodePreviewDialog
        item={{
          id: item.id,
          title: item.title,
          qrId: item.qrId,
          type: "asset",
          sequentialId: item.sequentialId,
        }}
        selectedBarcodeId={barcode.id}
        trigger={
          <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
            <button
              type="button"
              aria-label={`Show code preview for ${item.title}`}
              className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1"
            >
              <AssetCodeBadge
                value={barcode.value}
                type={barcode.type}
                isFallback={false}
                workspacePreference={workspacePreference}
                interactive
                // Explicit column: barcode column shows literal barcode values,
                // not the workspace-preferred one. Tooltip simplifies to
                // "<Type>: <value>".
                explicit
                className="cursor-pointer transition-colors hover:bg-gray-200"
              />
            </button>
          </Td>
        }
      />
    );
  }

  // If multiple barcodes of this type, show each as its own clickable chip in
  // a flex row. Replaces the previous comma-separated link list — chips have
  // their own padding so commas would be redundant visual noise.
  return (
    <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
      <div className="flex flex-wrap items-center gap-1.5">
        {barcodes.map((barcode) => (
          <CodePreviewDialog
            key={barcode.id}
            item={{
              id: item.id,
              title: item.title,
              sequentialId: item.sequentialId,
              qrId: item.qrId,
              type: "asset",
            }}
            selectedBarcodeId={barcode.id}
            trigger={
              <button
                type="button"
                aria-label={`Show code preview for ${item.title} (${barcode.value})`}
                className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1"
              >
                <AssetCodeBadge
                  value={barcode.value}
                  type={barcode.type}
                  isFallback={false}
                  workspacePreference={workspacePreference}
                  interactive
                  // Explicit column: see single-barcode case above.
                  explicit
                  className="cursor-pointer transition-colors hover:bg-gray-200"
                />
              </button>
            }
          />
        ))}
      </div>
    </Td>
  );
}

function UpcomingBookingsColumn({
  bookings,
}: {
  bookings: AdvancedIndexAsset["bookings"];
}) {
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();
  const canSeeAllCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings, // Here we can be sure as TeamMemberBadge is only used in the context of an organization/logged in route
  });

  if (!bookings || bookings.length === 0) {
    return <Td>No upcoming bookings</Td>;
  }

  return (
    <Td>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="link-gray">
            {bookings.length > 1
              ? `${bookings.length} upcoming bookings`
              : "1 upcoming booking"}
          </Button>
        </PopoverTrigger>

        <PopoverPortal>
          <PopoverContent
            align="start"
            className="flex max-h-64 w-auto max-w-full flex-col gap-1 overflow-auto rounded-md border bg-white p-4"
          >
            <h5 className="mb-1 border-b pb-2 text-sm">Upcoming Bookings</h5>
            {bookings.map((booking) => {
              const custodianName = booking?.custodianUser
                ? resolveUserDisplayName(booking.custodianUser)
                : booking.custodianTeamMember?.name;

              let title = booking.name;
              if (canSeeAllCustody) {
                title += ` | ${custodianName}`;
              }

              return (
                <HoverCard key={booking.id} openDelay={0} closeDelay={0}>
                  <HoverCardTrigger
                    className={tw(
                      getStatusClasses(
                        booking.status,
                        isOneDayEvent(booking.from, booking.to)
                      ),
                      "min-w-48 border px-2 py-1 text-left"
                    )}
                  >
                    <DateS
                      date={booking.from}
                      options={{ timeStyle: "short" }}
                    />{" "}
                    | {title}
                  </HoverCardTrigger>

                  <HoverCardPortal>
                    <HoverCardContent className="!mt-0 w-full rounded-md border bg-white px-4 py-2">
                      <EventCardContent
                        booking={{
                          id: booking.id,
                          name: booking.name,
                          description: booking.description,
                          status: booking.status,
                          tags: booking.tags,
                          start: booking.from,
                          end: booking.to,
                          custodian: {
                            name: custodianName ?? "",
                            user: booking.custodianUser
                              ? {
                                  id: booking.custodianUser.id,
                                  firstName: booking.custodianUser.firstName,
                                  lastName: booking.custodianUser.lastName,
                                  profilePicture:
                                    booking.custodianUser.profilePicture,
                                }
                              : null,
                          },
                          creator: {
                            name: booking.creator
                              ? resolveUserDisplayName(booking.creator)
                              : "Unknown",
                            user: booking.creator
                              ? {
                                  id: booking.creator.id,
                                  firstName: booking.creator.firstName,
                                  lastName: booking.creator.lastName,
                                  profilePicture:
                                    booking.creator.profilePicture,
                                }
                              : null,
                          },
                        }}
                      />
                    </HoverCardContent>
                  </HoverCardPortal>
                </HoverCard>
              );
            })}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </Td>
  );
}
