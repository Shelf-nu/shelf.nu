import type { ReactElement, ReactNode } from "react";
import React from "react";
import { useLoaderData } from "react-router";

import { useAssetIndexView } from "~/hooks/use-asset-index-view";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useIsUserAssetsPage } from "~/hooks/use-is-user-assets-page";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import BulkListItemCheckbox from "./bulk-actions/bulk-list-item-checkbox";
import { EmptyState } from "./empty-state";

import { ListHeader } from "./list-header";
import type { ListItemData } from "./list-item";
import { ListItem } from "./list-item";
import ListTitle from "./list-title";
import { Pagination } from "./pagination";
import { ExportAssetsButton } from "../assets/assets-index/export-assets-button";
import type { Button } from "../shared/button";
import { Table } from "../table";
import When from "../when/when";

export interface IndexResponse {
  header: {
    title: string;
    subTitle?: string;
  };
  /** Page number. Starts at 1 */
  page: number;

  /** Items to be loaded per page */
  perPage: number;

  /** Items to be rendered in the list */
  items: ListItemData[];

  categoriesIds?: string[];

  /** Total items - before filtering */
  totalItems: number;

  /** Total pages */
  totalPages: number;

  /** Search string */
  search: string | null;

  /** Used so all the default actions can be generate such as empty state, creating and so on */
  modelName: {
    singular: string;
    plural: string;
  };
}

export type ListProps = {
  title?: string;
  ItemComponent: any;
  headerChildren?: ReactNode;
  hideFirstHeaderColumn?: boolean;
  /** Function to be passed if the rows of the table should navigate */
  navigate?: (id: string, item: ListItemData) => void;
  className?: string;
  customEmptyStateContent?: {
    title: string;
    text: ReactNode;
    newButtonRoute?: string;
    newButtonContent?: string;
    buttonProps?: Partial<React.ComponentProps<typeof Button>>;
  };
  emptyStateClassName?: string;
  /**
   * Allow bulk actions on List by providing Bulk actions dropdown
   */
  bulkActions?: ReactElement;

  /** Optionally recieve an element for custom pagination */
  customPagination?: ReactElement;
  /** Any extra content to the right in Header */
  headerExtraContent?: ReactNode;
  /** Any extra props directly passed to ItemComponent */
  extraItemComponentProps?: Record<string, unknown>;

  /** We have some views where the select all pages is not realistic to work, because we have some disabled items
   * This should be used in those cases
   */
  disableSelectAllItems?: boolean;

  /**
   * Rows to render. Defaults to the loader's `items` — pass this only when a
   * view renders rows the loader supplies under a different key.
   *
   * These rows are also what the header's select-all checkbox ticks and what
   * the title counts, so they must be the rows actually on screen. A list
   * rendering one set while those two read `loaderData.items` gets a checkbox
   * that selects rows nobody can see.
   */
  items?: ListItemData[];

  /**
   * Overrides the count line under the title.
   *
   * For a list whose rendered rows are not all instances of the thing the
   * title names: the model view renders a "No model" bucket alongside the
   * models, so the row count and the model count are different numbers.
   */
  countLabel?: () => ReactNode;

  /** Whether `countLabel` already states the total; see `ListTitle`. */
  countLabelIsTotal?: boolean;
};

/**
 * The route is required to export {@link IndexResponse}
 */
export const List = React.forwardRef<HTMLDivElement, ListProps>(function List(
  {
    title,
    ItemComponent,
    headerChildren,
    hideFirstHeaderColumn = false,
    navigate,
    className,
    customEmptyStateContent,
    emptyStateClassName,
    bulkActions,
    customPagination,
    headerExtraContent,
    extraItemComponentProps,
    disableSelectAllItems,
    items: itemsProp,
    countLabel,
    countLabelIsTotal,
  }: ListProps,
  ref
) {
  const { items: loaderItems } = useLoaderData<IndexResponse>();
  const items = itemsProp ?? loaderItems;
  const totalIncomingItems = items?.length;
  const hasItems = totalIncomingItems > 0;

  const { modeIsAdvanced } = useAssetIndexViewState();
  const roles = useOrganizationRoles();
  // Export selection downloads through a route gated on asset export.
  const canExportAssets = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.export,
  });
  // The export button ships ASSET rows. The model view lists models, so it
  // has nothing to export and no selectable rows to export from.
  const { isModelView } = useAssetIndexView();

  const isUserPage = useIsUserAssetsPage();

  return (
    <div
      ref={ref}
      className={tw(
        "-mx-4 border border-gray-200 bg-white md:mx-0 md:rounded",
        modeIsAdvanced ? "flex h-full flex-col" : "overflow-auto",
        className
      )}
    >
      {!hasItems ? (
        <EmptyState
          className={emptyStateClassName}
          customContent={customEmptyStateContent}
        />
      ) : (
        <>
          {/* The title and the total number of items. This basically acts like a fake table row */}
          <div
            className={tw(
              modeIsAdvanced ? "p-3 pb-[5px]" : "flex-col p-4 pb-2 md:flex-row",
              "flex justify-between border-b md:items-center "
            )}
          >
            <div>
              <ListTitle
                title={title}
                disableSelectAllItems={disableSelectAllItems}
                hasBulkActions={!!bulkActions}
                items={items}
                countLabel={countLabel}
                countLabelIsTotal={countLabelIsTotal}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <When truthy={!!headerExtraContent}>{headerExtraContent}</When>
              <When truthy={modeIsAdvanced && !isModelView && canExportAssets}>
                <ExportAssetsButton />
              </When>
              <When truthy={!!bulkActions}>{bulkActions}</When>
            </div>
          </div>
          <Table
            className={tw("list", bulkActions && "list-with-bulk-actions")}
          >
            <ListHeader
              bulkActions={bulkActions}
              items={items}
              hideFirstColumn={hideFirstHeaderColumn}
            >
              {headerChildren}
            </ListHeader>
            <tbody>
              {items.map((item) => (
                <ListItem item={item} key={item.id} navigate={navigate}>
                  {bulkActions ? <BulkListItemCheckbox item={item} /> : null}
                  <ItemComponent
                    item={item}
                    extraProps={extraItemComponentProps}
                    bulkActions={bulkActions}
                    isUserPage={isUserPage}
                  />
                </ListItem>
              ))}
            </tbody>
          </Table>
          {!customPagination && <Pagination />}
        </>
      )}
      {/*  Always render it, even if no items in list. */}
      {customPagination && customPagination}
    </div>
  );
});
