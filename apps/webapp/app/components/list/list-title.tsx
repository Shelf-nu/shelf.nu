import type { ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { useLoaderData } from "react-router";
import {
  clearSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import { tw } from "~/utils/tw";
import type { IndexResponse } from ".";
import type { ListItemData } from "./list-item";
import { Button } from "../shared/button";
import type { LoaderData } from "./bulk-actions/bulk-list-header";

type ListTitleProps = {
  title?: string;
  hasBulkActions: boolean;
  disableSelectAllItems?: boolean;
  /**
   *
   * This function is used to retrieve the items to be added in bulk-items when "Select All" is clicked.
   * It is useful when the loader data structure is different from the default one.
   * For example, the loader data on booking page is structured as:
   *
   * ```javascript
   * {
   *  paginatedItems: [
   *    { type: "kit", assets: [...] },
   *    { type: "asset", ... },
   *  ]
   * }
   * ```
   *
   * @param data Loader data containing items
   * @returns An array of ListItemData to be used in the header
   */
  itemsGetter?: (data: LoaderData) => ListItemData[];

  /**
   * Optional class name for the title element
   */
  titleClassName?: string;

  /**
   * Describes the rendered rows in the surface's own words, replacing the
   * default `"N items"`.
   *
   * The default noun comes from `modelName`, which is necessarily generic when
   * a list holds more than one kind of row. The booking overview mixes assets
   * and kits, so its header read "20 items" while the bookings index reported
   * 25 assets for the same booking — the difference being the 7 assets folded
   * inside 2 kit rows. Neither number was wrong; "items" just never said what
   * it counted, leaving the reader to work it out.
   *
   * Takes no argument on purpose: a surface that can describe its rows knows
   * the rows, and passing a count invited an implementation to ignore it and
   * silently disagree with the number ListTitle thought it was labelling.
   * Return a phrase, not a sentence — it renders inline and may be followed by
   * "out of N".
   *
   * @returns e.g. `"18 assets and 2 kits"`.
   */
  countLabel?: () => ReactNode;
};

export default function ListTitle({
  title,
  hasBulkActions,
  disableSelectAllItems = false,
  itemsGetter,
  titleClassName,
  countLabel,
}: ListTitleProps) {
  const loaderData = useLoaderData<LoaderData>();
  const {
    totalItems,
    perPage,
    modelName: { singular, plural },
  } = loaderData as unknown as IndexResponse;

  /**
   * SELECTION list. When `itemsGetter` is supplied it flattens composite rows
   * into their selectable entities — the booking overview expands each kit row
   * into its member assets plus the kit itself. Right for "select all", wrong
   * for any count shown to a human.
   */
  const items =
    typeof itemsGetter === "function"
      ? itemsGetter(loaderData)
      : loaderData.items;

  /**
   * DISPLAY count: rows actually rendered on this page.
   *
   * Must not come from `items` above. On the booking overview a 10-row page
   * containing two kits (4 and 3 members) flattens to 17 selectable entities,
   * so the header read "17 items out of 20" — a number matching neither the
   * rows on screen nor the total. Identical to `items.length` on every list
   * that passes no `itemsGetter`.
   */
  const rowCount = loaderData.items?.length ?? 0;

  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);
  const clearSelectedItems = useSetAtom(clearSelectedBulkItemsAtom);
  const hasSelectedItems = selectedBulkItemsCount > 0;

  /**
   * We can select all the incoming items and we can add ALL_SELECTED_KEY
   * in the selected items. We check in backend for this ALL_SELECTED_KEY, if it is selected
   * then we do operation on all items of organization
   */
  function handleSelectAllItems() {
    setSelectedBulkItems([...items, { id: ALL_SELECTED_KEY }]);
  }

  return (
    <div>
      <div
        className={tw(
          "text-left text-text-sm font-semibold capitalize text-gray-900",
          titleClassName
        )}
      >
        {title || plural}
      </div>
      <div className="h-7">
        {hasBulkActions && hasSelectedItems ? (
          <div className="flex items-start gap-2">
            <Button
              type="button"
              onClick={clearSelectedItems}
              variant="secondary"
              className="p-[2px] text-[14px]"
              aria-label="Clear selected items"
            >
              <X size={12} strokeWidth={3} className="text-gray-600" />
            </Button>
            {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
            {!disableSelectAllItems &&
              !hasSelectedAllItems &&
              selectedBulkItemsCount < totalItems && (
                <Button
                  type="button"
                  onClick={handleSelectAllItems}
                  variant="block-link"
                >
                  Select all {totalItems} entries
                </Button>
              )}
          </div>
        ) : (
          <div>
            {/* Both branches pluralise on the count, not on `> 1` — an empty
                list read "0 item". Only exactly one is singular. */}
            {perPage < totalItems ? (
              <p>
                {countLabel
                  ? countLabel()
                  : `${rowCount} ${rowCount === 1 ? singular : plural}`}{" "}
                <span className="text-gray-400">out of {totalItems}</span>
              </p>
            ) : (
              <span>
                {/* The noun agrees with the number actually PRINTED. This
                    branch prints `totalItems` but pluralised on `rowCount`,
                    which are different quantities — and a header that lies
                    about its own count is the defect this whole change is
                    about. Narrow in practice (the branch only runs when
                    `perPage >= totalItems`), but both branches should derive
                    the noun from the number beside it. */}
                {countLabel
                  ? countLabel()
                  : `${totalItems} ${totalItems === 1 ? singular : plural}`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
