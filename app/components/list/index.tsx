import type { ReactNode } from "react";
import React from "react";
import { useLoaderData } from "@remix-run/react";

import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useIsUserAssetsPage } from "~/hooks/use-is-user-assets-page";
import { tw } from "~/utils/tw";
import BulkListItemCheckbox from "./bulk-actions/bulk-list-item-checkbox";
import { EmptyState } from "./empty-state";

import { ListHeader } from "./list-header";
import type { ListItemData } from "./list-item";
import { ListItem } from "./list-item";
import ListTitle from "./list-title";
import { Pagination } from "./pagination";
import { ExportAssetsButton } from "../assets/assets-index/export-assets-button";
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
    text: React.ReactNode;
    newButtonRoute?: string;
    newButtonContent?: string;
    buttonProps?: any;
  };
  emptyStateClassName?: string;
  /**
   * Allow bulk actions on List by providing Bulk actions dropdown
   */
  bulkActions?: React.ReactElement;

  /** Optionally recieve an element for custom pagination */
  customPagination?: React.ReactElement;
  /** Any extra content to the right in Header */
  headerExtraContent?: React.ReactNode;
  /** Any extra props directly passed to ItemComponent */
  extraItemComponentProps?: Record<string, unknown>;

  /** We have some views where the select all pages is not realistic to work, because we have some disabled items
   * This should be used in those cases
   */
  disableSelectAllItems?: boolean;
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
  }: ListProps,
  ref
) {
  const { items } = useLoaderData<IndexResponse>();
  const totalIncomingItems = items?.length;
  const hasItems = totalIncomingItems > 0;

  const { modeIsAdvanced } = useAssetIndexViewState();

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
              modeIsAdvanced ? "p-3 pb-[5px]" : "p-4 pb-2",
              "flex items-center justify-between border-b "
            )}
          >
            <div>
              <ListTitle
                title={title}
                disableSelectAllItems={disableSelectAllItems}
                hasBulkActions={!!bulkActions}
              />
            </div>
            <div className="flex items-center gap-2">
              <When truthy={!!headerExtraContent}>{headerExtraContent}</When>
              <When truthy={modeIsAdvanced}>
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
              children={headerChildren}
              hideFirstColumn={hideFirstHeaderColumn}
            />
            <tbody>
              {items.map((item, i) => (
                <ListItem
                  item={item}
                  key={`${item.id}-${i}`}
                  navigate={navigate}
                >
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
