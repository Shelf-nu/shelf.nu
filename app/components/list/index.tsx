import type { ReactNode } from "react";
import { useLoaderData } from "@remix-run/react";
import type { IndexResponse } from "~/routes/_layout+/assets._index";

import { tw } from "~/utils/tw";
import { EmptyState } from "./empty-state";

import { ListHeader } from "./list-header";
import { ListItem } from "./list-item";
import { Pagination } from "./pagination";
import { Table } from "../table";

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
}: {
  ItemComponent: any;
  headerChildren?: ReactNode;
  hideFirstHeaderColumn?: boolean;
  /** Function to be passed if the rows of the table should navigate */
  navigate?: (id: string) => void;
  className?: string;
  customEmptyStateContent?: {
    title: string;
    text: string;
    newButtonRoute: string;
    newButtonContent: string;
    buttonProps?: any;
  };
}) => {
  const { items } = useLoaderData<IndexResponse>();
  const hasItems = items?.length > 0;

  return (
    <div
      className={tw(
        "-mx-4 overflow-x-auto border border-gray-200  bg-white md:mx-0 md:rounded",
        className
      )}
    >
      {!hasItems ? (
        <EmptyState customContent={customEmptyStateContent} />
      ) : (
        <>
          <Table>
            <ListHeader
              children={headerChildren}
              hideFirstColumn={hideFirstHeaderColumn}
            />
            <tbody>
              {items.map((item) => (
                <ListItem item={item} key={item.id} navigate={navigate}>
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
