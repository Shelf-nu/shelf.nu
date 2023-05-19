import type { ListItemData } from "~/components/list/list-item";
import { EmptyState } from "./empty-state";

import { ListHeader } from "./list-header";
import { ListItem } from "./list-item";
import { Pagination } from "./pagination";
/**
 * List components takes advantage use `useFetcher()`
 * to get the data of the parent route.
 *
 * The route is required to export {@link IndexResponse}
 */

interface ListProps {
  ItemComponent: any;
  items: ListItemData[];
  totalItems: number;
  modelName: {
    singular: string;
    plural: string;
  };
  perPage: number;
  page: number;
  search: string | null;
  totalPages: number;
  next: string;
  prev: string;
}
export const List = ({
  ItemComponent,
  items,
  totalItems,
  modelName,
  perPage,
  page,
  search,
  totalPages,
  prev,
  next,
}: ListProps) => {
  const hasItems = items?.length > 0;

  return (
    <div className="-mx-4 border border-gray-200 bg-white  md:mx-0 md:rounded-[12px]">
      {!hasItems ? (
        <EmptyState modelName={modelName} search={search} />
      ) : (
        <div>
          <ListHeader
            items={items}
            totalItems={totalItems}
            modelName={modelName}
            perPage={perPage}
          />

          <div>
            {items.map((item: any) => (
              <ListItem item={item} key={item.id}>
                <ItemComponent item={item} />
              </ListItem>
            ))}
          </div>

          <Pagination
            totalItems={totalItems}
            totalPages={totalPages}
            perPage={perPage}
            page={page}
            prev={prev}
            next={next}
          />
        </div>
      )}
    </div>
  );
};
