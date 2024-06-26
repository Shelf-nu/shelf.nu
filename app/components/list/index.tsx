import type { ReactNode } from "react";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { selectedBulkItemsCountAtom } from "~/atoms/list";
import type { IndexResponse } from "~/routes/_layout+/assets._index";

import { tw } from "~/utils/tw";
import BulkListItemCheckbox from "./bulk-actions/bulk-list-item-checkbox";
import { EmptyState } from "./empty-state";

import { ListHeader } from "./list-header";
import type { ListItemData } from "./list-item";
import { ListItem } from "./list-item";
import { Pagination } from "./pagination";
import { Table } from "../table";

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
              <h5>{title || header.title}</h5>
              <div className="flex justify-between">
                {selectedBulkItemsCount > 0 ? (
                  <span>{selectedBulkItemsCount} selected</span>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
            <div>{bulkActions}</div>
          </div>

          <Table>
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
