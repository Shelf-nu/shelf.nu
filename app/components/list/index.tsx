import type { ReactNode } from "react";
import { useLoaderData } from "@remix-run/react";
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
  ItemComponent,
  headerChildren,
  hideFirstHeaderColumn = false,
  navigate,
  className,
  customEmptyStateContent,
  emptyStateClassName,
  bulkActions,
}: ListProps) => {
  const { items } = useLoaderData<IndexResponse>();
  const totalIncomingItems = items.length;
  const hasItems = totalIncomingItems > 0;

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
