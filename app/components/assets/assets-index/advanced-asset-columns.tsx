import React from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import { CustomFieldType, type AssetStatus } from "@prisma/client";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { Link, useLoaderData } from "@remix-run/react";
import LineBreakText from "~/components/layout/line-break-text";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Td as BaseTd } from "~/components/table";
import When from "~/components/when/when";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";

import { useAssetIndexShowImage } from "~/hooks/use-asset-index-show-image";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";

import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type {
  AdvancedIndexAsset,
  ShelfAssetCustomFieldValueType,
} from "~/modules/asset/types";
import type { ColumnLabelKey } from "~/modules/asset-index-settings/helpers";
// eslint-disable-next-line import/no-cycle
import {
  ListItemTagsColumn,
  type AssetIndexLoaderData,
} from "~/routes/_layout+/assets._index";
import { getCustomFieldDisplayValue } from "~/utils/custom-fields";
import { isLink } from "~/utils/misc";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { freezeColumnClassNames } from "./freeze-column-classes";
import { AssetImage } from "../asset-image";
import { AssetStatusBadge } from "../asset-status-badge";
import { QrPreviewDialog } from "../qr-preview-dialog";
import AssetQuickActions from "./asset-quick-actions";

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
      return <Td> </Td>;
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
            "min-w-[300px] max-w-[400px] whitespace-normal",
            modeIsAdvanced && freezeColumn ? freezeColumnClassNames.name : ""
          )}
          value={
            <div className={tw("flex items-center gap-2 ")}>
              {showAssetImage ? (
                <AssetImage
                  asset={{
                    assetId: item.id,
                    mainImage: item.mainImage,
                    mainImageExpiration: item.mainImageExpiration,
                    alt: item.title,
                  }}
                  className="size-10 rounded-[4px] border object-cover"
                  withPreview={!!item.mainImage}
                />
              ) : null}

              <div>
                <Link
                  to={item.id}
                  className="font-medium underline hover:text-gray-600"
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

    case "qrId":
      return (
        <QrPreviewDialog
          asset={item}
          trigger={
            <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
              <Button variant="link-gray">{item.qrId}</Button>
            </Td>
          }
        />
      );

    case "status":
      return <StatusColumn status={item.status} />;

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
              ""
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
              ""
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

function StatusColumn({ status }: { status: AssetStatus }) {
  return (
    <Td className="w-full max-w-none whitespace-nowrap">
      {/* Here iwe pass `true` to availableToBook just to make sure its not visible next to status as it has its own column  */}
      <AssetStatusBadge status={status} availableToBook={true} />
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
      {category ? (
        <Badge color={category.color} withDot={false}>
          {category.name}
        </Badge>
      ) : (
        <Badge color={"#808080"} withDot={false}>
          {"Uncategorized"}
        </Badge>
      )}
    </Td>
  );
}

function TagsColumn({ tags }: { tags: AdvancedIndexAsset["tags"] }) {
  return (
    <Td className="text-left">
      {tags.length > 0 && <ListItemTagsColumn tags={tags} />}
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
        {custody ? (
          <GrayBadge>
            <>
              {custody.custodian?.user ? (
                <img
                  src={
                    custody.custodian?.user?.profilePicture ||
                    "/static/images/default_pfp.jpg"
                  }
                  className="mr-1 size-4 rounded-full"
                  alt=""
                />
              ) : null}
              <span className="mt-px">
                {resolveTeamMemberName({
                  name: custody.custodian.name,
                  user: custody.custodian?.user
                    ? {
                        firstName: custody.custodian?.user?.firstName || null,
                        lastName: custody.custodian?.user?.lastName || null,
                        profilePicture:
                          custody.custodian?.user?.profilePicture || null,
                        email: custody.custodian?.user?.email || "",
                      }
                    : undefined,
                })}
              </span>
            </>
          </GrayBadge>
        ) : null}
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
