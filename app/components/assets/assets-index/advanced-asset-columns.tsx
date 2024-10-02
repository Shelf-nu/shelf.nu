import React from "react";
import type { RenderableTreeNode } from "@markdoc/markdoc";
import {
  CustomFieldType,
  type AssetStatus,
  type Category,
  type Tag,
} from "@prisma/client";
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
import { Td } from "~/components/table";
import When from "~/components/when/when";
import { useAssetIndexFreezeColumn } from "~/hooks/use-asset-index-freeze-column";
import { useAssetIndexMode } from "~/hooks/use-asset-index-mode";
import { useAssetIndexShowImage } from "~/hooks/use-asset-index-show-image";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type {
  AssetsFromViewItem,
  ShelfAssetCustomFieldValueType,
} from "~/modules/asset/types";
import type { fixedFields } from "~/modules/asset-index-settings/helpers";
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

export function AdvancedIndexColumn({
  column,
  item,
}: {
  column: (typeof fixedFields)[number];
  item: AssetsFromViewItem;
}) {
  const { locale, currentOrganization, timeZone } =
    useLoaderData<AssetIndexLoaderData>();
  const showAssetImage = useAssetIndexShowImage();
  const freezeColumn = useAssetIndexFreezeColumn();
  const { modeIsAdvanced } = useAssetIndexMode();

  const isCustomField = column.startsWith("cf_");

  if (isCustomField) {
    const fieldName = column.replace("cf_", "");
    const field = item.customFields.find(
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
                  "mt-1 min-w-[300px] rounded-md border border-gray-300 bg-white p-4"
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
                />
              ) : null}

              <div>
                <Link to={item.id} className="font-medium underline">
                  {item.title}
                </Link>
              </div>
            </div>
          }
        />
      );
    case "id":
      return <TextColumn value={item.id} />;
    case "status":
      return (
        <StatusColumn
          status={item.status}
          availableToBook={item.availableToBook}
        />
      );

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
      return <TagsColumn tags={item.tags ?? []} />;

    case "location":
      return <TextColumn value={item?.location?.name || ""} />;

    case "kit":
      return <TextColumn value={item?.kit?.name || ""} />;

    case "custody":
      return <CustodyColumn custody={item.custody} />;
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
      {value}
    </Td>
  );
}

function StatusColumn({
  status,
  availableToBook,
}: {
  status: AssetStatus;
  availableToBook: boolean;
}) {
  return (
    <Td className="w-full max-w-none whitespace-nowrap">
      <AssetStatusBadge status={status} availableToBook={availableToBook} />
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
  category: Category | null | undefined;
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

function TagsColumn({ tags }: { tags: Tag[] }) {
  return (
    <Td className="text-left">
      <ListItemTagsColumn tags={tags} />
    </Td>
  );
}

function CustodyColumn({
  custody,
}: {
  custody: AssetsFromViewItem["custody"];
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