import React from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import type { AssetStatus } from "@prisma/client";
import { CustomFieldType } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { Link, useLoaderData } from "@remix-run/react";
import { EventCardContent } from "~/components/calendar/event-card";
import LineBreakText from "~/components/layout/line-break-text";
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
import { Td as BaseTd } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import When from "~/components/when/when";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";

import { useAssetIndexShowImage } from "~/hooks/use-asset-index-show-image";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";

import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type {
  AdvancedIndexAsset,
  ShelfAssetCustomFieldValueType,
} from "~/modules/asset/types";
import type {
  ColumnLabelKey,
  BarcodeField,
} from "~/modules/asset-index-settings/helpers";
import { type AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { formatCurrency } from "~/utils/currency";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { isLink } from "~/utils/misc";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { freezeColumnClassNames } from "./freeze-column-classes";
import { CodePreviewDialog } from "../../code-preview/code-preview-dialog";
import { AssetImage } from "../asset-image/component";
import { AssetStatusBadge } from "../asset-status-badge";
import AssetQuickActions from "./asset-quick-actions";
// eslint-disable-next-line import/no-cycle
import { ListItemTagsColumn } from "./assets-list";
import { CategoryBadge } from "../category-badge";

export function AdvancedIndexColumn({
  column,
  item,
}: {
  column: ColumnLabelKey;
  item: AdvancedIndexAsset;
}) {
  const { locale, currentOrganization, timeZone } =
    useLoaderData<AssetIndexLoaderData>();
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

    const customFieldDisplayValue = getCustomFieldDisplayValue(fieldValue, {
      locale,
      timeZone,
    });

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
                <Link
                  to={item.id}
                  className="truncate font-medium underline hover:text-gray-600"
                  title={item.title}
                >
                  {item.title}
                </Link>
              </div>
            </div>
          }
        />
      );

    case "id":
      return <TextColumn value={item[column]} />;

    case "sequentialId":
      return <TextColumn value={item[column] || ""} />;

    case "qrId":
      return (
        <CodePreviewDialog
          item={{
            id: item.id,
            title: item.title,
            qrId: item.qrId,
            type: "asset",
            sequentialId: item.sequentialId,
          }}
          trigger={
            <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
              <Button variant="link-gray">{item.qrId}</Button>
            </Td>
          }
        />
      );

    case "status":
      return <StatusColumn id={item.id} status={item.status} />;

    case "description":
      return <DescriptionColumn value={item.description ?? ""} />;

    case "valuation":
      const value = item?.valuation?.toLocaleString(locale, {
        currency: currentOrganization.currency,
        style: "currency",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return <TextColumn value={value ?? ""} />;

    case "createdAt":
      return <DateColumn value={item.createdAt} />;

    case "category":
      return <CategoryColumn category={item.category} />;

    case "tags":
      return <TagsColumn tags={item.tags} />;

    case "location":
      return (
        <TextColumn
          value={
            item?.location?.name ? (
              <Button
                to={`/locations/${item.locationId}`}
                title={item.location.name}
                target="_blank"
                variant="link-gray"
              >
                {item.location.name}
              </Button>
            ) : (
              <EmptyTableValue />
            )
          }
        />
      );

    case "kit":
      return (
        <TextColumn
          value={
            item?.kit?.name ? (
              <Link
                to={`/kits/${item.kitId}`}
                className="block max-w-[220px] truncate font-medium underline hover:text-gray-600"
                title={item.kit.name}
              >
                {item.kit.name}
              </Link>
            ) : (
              <EmptyTableValue />
            )
          }
        />
      );

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
      return <BarcodeColumn column={column} item={item} />;

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
  value: string | React.ReactNode;
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

function StatusColumn({ id, status }: { id: string; status: AssetStatus }) {
  return (
    <Td className="w-full max-w-none whitespace-nowrap">
      <AssetStatusBadge id={id} status={status} availableToBook={true} />
    </Td>
  );
}

function DescriptionColumn({ value }: { value: string }) {
  return (
    <Td className="max-w-62 whitepsace-pre-wrap">
      {/* Only show tooltip when value is more than 60 - 2 rows of 30 */}
      {value.length > 60 ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="text-left">
              <LineBreakText text={value} />
            </TooltipTrigger>

            <TooltipContent side="top" className="max-w-[400px]">
              <h5>Asset description</h5>
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

function DateColumn({ value }: { value: string | Date }) {
  return (
    <Td className="w-full max-w-none whitespace-nowrap">
      <DateS date={value} />
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

function CustodyColumn({
  custody,
}: {
  custody: AdvancedIndexAsset["custody"];
}) {
  const { roles } = useUserRoleHelper();

  return (
    <When
      truthy={userHasPermission({
        roles,
        entity: PermissionEntity.custody,
        action: PermissionAction.read,
      })}
    >
      <Td>
        {custody?.custodian ? (
          <TeamMemberBadge teamMember={custody?.custodian} />
        ) : (
          <EmptyTableValue />
        )}
      </Td>
    </When>
  );
}

function Td({ className, ...rest }: React.ComponentProps<typeof BaseTd>) {
  return <BaseTd className={tw("p-[2px]", className)} {...rest} />;
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
            {upcomingReminder.displayDate}
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
}: {
  column: BarcodeField;
  item: AdvancedIndexAsset;
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

  // If only one barcode, show as a single clickable link
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
            <Button variant="link-gray">{barcode.value}</Button>
          </Td>
        }
      />
    );
  }

  // If multiple barcodes, show as comma-separated clickable links
  return (
    <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
      {barcodes.map((barcode, index) => (
        <span key={barcode.id}>
          <CodePreviewDialog
            item={{
              id: item.id,
              title: item.title,
              sequentialId: item.sequentialId,
              qrId: item.qrId,
              type: "asset",
            }}
            selectedBarcodeId={barcode.id}
            trigger={<Button variant="link-gray">{barcode.value}</Button>}
          />
          {index < barcodes.length - 1 && (
            <span className="text-gray-600">, </span>
          )}
        </span>
      ))}
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
          <Button variant="link-gray">
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
                ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
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
                              ? `${booking.creator.firstName} ${booking.creator.lastName}`.trim()
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
