import type { ReactNode } from "react";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";

import { ALL_SELECTED_KEY } from "~/utils/list";
import { tw } from "~/utils/tw";
import BulkListItemCheckbox from "./bulk-actions/bulk-list-item-checkbox";
import { EmptyState } from "./empty-state";

import { ListHeader } from "./list-header";
import type { ListItemData } from "./list-item";
import { ListItem } from "./list-item";
import { Pagination } from "./pagination";
import { Button } from "../shared/button";
import { Table } from "../table";

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
    text: string;
    newButtonRoute?: string;
    newButtonContent?: string;
    buttonProps?: any;
  };
  emptyStateClassName?: string;
  /**
   * Allow bulk actions on List by providing Bulk actions dropdown
   */
  bulkActions?: React.ReactElement;
};

/**
 * The route is required to export {@link IndexResponse}
 */
export const List = ({
  title,
  ItemComponent,
  headerChildren,
  hideFirstHeaderColumn = false,
  navigate,
  className,
  customEmptyStateContent,
  emptyStateClassName,
  bulkActions,
}: ListProps) => {
  const { items, totalItems, perPage, modelName, header } =
    useLoaderData<IndexResponse>();
  const { singular, plural } = modelName;
  const totalIncomingItems = items.length;
  const hasItems = totalIncomingItems > 0;
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const hasSelectedAllItems = selectedBulkItems.includes(ALL_SELECTED_KEY);

  /**
   * We can select all the incoming items and we can add ALL_SELECTED_KEY
   * in the selected items. We check in backend for this ALL_SELECTED_KEY, if it is selected
   * then we do operation on all items of organization
   */
  function handleSelectAllItems() {
    setSelectedBulkItems([...items.map((item) => item.id), ALL_SELECTED_KEY]);
  }

  return (
    <div
      className={tw(
        "-mx-4 overflow-x-auto border border-gray-200  bg-white md:mx-0 md:rounded",
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
          <div className="flex items-center justify-between border-b p-4">
            <div>
              <div className="">
                {selectedBulkItemsCount > 0 ? (
                  <div className="flex items-end gap-2">
                    <div>
                      <h5>{title || header.title}</h5>
                      <div className="flex items-center gap-2">
                        {selectedBulkItems.length && (
                          <Button
                            onClick={() => setSelectedBulkItems([])}
                            variant="secondary"
                            className="p-1 text-[14px]"
                          >
                            <span className="block size-2">
                              <svg
                                width="100%"
                                height="100%"
                                viewBox="0 0 10 10"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M9 1 1 9m0-8 8 8"
                                  stroke="currentColor"
                                  strokeWidth={1.333}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          </Button>
                        )}
                        {hasSelectedAllItems
                          ? totalItems
                          : selectedBulkItemsCount}{" "}
                        selected
                      </div>
                    </div>
                    {!hasSelectedAllItems &&
                      selectedBulkItemsCount < totalItems && (
                        <Button
                          onClick={handleSelectAllItems}
                          variant="link"
                          className="-mb-1 px-2 py-1 text-[14px] font-normal hover:bg-primary-50 hover:text-primary-600"
                        >
                          Select all {totalItems} entries
                        </Button>
                      )}
                  </div>
                ) : (
                  <>
                    <h5 className="capitalize">{title || plural}</h5>
                    <div>
                      {perPage < totalItems ? (
                        <p>
                          {items.length} {items.length > 1 ? plural : singular}{" "}
                          <span className="text-gray-400">
                            out of {totalItems}
                          </span>
                        </p>
                      ) : (
                        <span>
                          {totalItems} {items.length > 1 ? plural : singular}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div>{bulkActions}</div>
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
                  <ItemComponent item={item} />
                </ListItem>
              ))}
            </tbody>
          </Table>
          <Pagination />
        </>
      )}
    </div>
  );
};
