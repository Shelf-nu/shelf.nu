/**
 * Asset Model Sort Header
 *
 * A sortable column header for the asset index's model view, and the view's
 * only sort control: the button writes `modelSortBy` and `modelSortDirection`
 * into the URL, the loader re-runs the rollup, and the header reads the sort
 * back off the loader so it can only ever show the ordering the server actually
 * applied.
 *
 * Columns the rollup cannot order by do not get one. `sortKey` is typed against
 * the rollup's key list, so a header for such a column will not compile, which
 * matters because the server silently falls back to name: the header would
 * display a sort nobody performed.
 *
 * That key list is reached here as a TYPE only. The rollup module is
 * server-only, so importing its runtime whitelist would pull it into the client
 * bundle and the route would fail to load.
 *
 * @see {@link file://./../../../modules/asset-model/sort-params.ts}
 * @see {@link file://./../../../modules/asset-model/rollup.server.ts}
 * @see {@link file://./assets-list.tsx}
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useLoaderData } from "react-router";
import { Th } from "~/components/table";
import { useSearchParams } from "~/hooks/search-params";
import type { AssetModelRollupSortKey } from "~/modules/asset-model/rollup.server";
import {
  resolveAssetModelAriaSort,
  resolveNextAssetModelSort,
} from "~/modules/asset-model/sort-params";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";

/**
 * Renders a header cell whose label sorts the model list.
 *
 * The sort state is announced through `aria-sort` on the cell, which is what
 * assistive technology reads for a sortable column; the arrow is decorative and
 * hidden from it. The control itself is a button, so it is reachable and
 * operable by keyboard with no extra key handling.
 *
 * @param sortKey - Rollup column to order by.
 * @param label - Visible header text, and the noun the tooltip names when
 *   `sortsBy` is absent.
 * @param sortsBy - What the column orders on, for a cell that shows several
 *   numbers and so cannot say it in the header alone. Added to the button's
 *   accessible name and named in its tooltip.
 * @param className - Extra classes for the header cell.
 * @param columnName - Written to `data-column-name`, matching how the index's
 *   other header cells identify themselves.
 */
export function AssetModelSortHeader({
  sortKey,
  label,
  sortsBy,
  className,
  columnName,
}: {
  sortKey: AssetModelRollupSortKey;
  label: string;
  sortsBy?: string;
  className?: string;
  columnName?: string;
}) {
  const { modelSortBy, modelSortDirection } =
    useLoaderData<AssetIndexLoaderData>();
  const [, setSearchParams] = useSearchParams();

  const active = {
    activeSortBy: modelSortBy,
    activeSortDirection: modelSortDirection,
  };
  const ariaSort = resolveAssetModelAriaSort({ sortKey, ...active });
  /** The sort this header's click produces, which is also what its tooltip
   * promises: a click on the sorted column reverses it rather than re-applying
   * the direction it is already in. */
  const next = resolveNextAssetModelSort({ sortKey, ...active });

  function applySort() {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("modelSortBy", next.sortBy);
      params.set("modelSortDirection", next.sortDirection);
      // A re-sort reorders the whole set, so the page the reader is on names a
      // different slice of models afterwards. Start them at the first page of
      // the new order instead.
      params.delete("page");
      return params;
    });
  }

  return (
    <Th
      className={tw("whitespace-nowrap", className)}
      data-column-name={columnName}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={applySort}
        title={`Sort by ${sortsBy ?? label.toLowerCase()}, ${
          next.sortDirection === "asc" ? "ascending" : "descending"
        }`}
        className="group/sort inline-flex items-center gap-1 rounded font-normal text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1"
      >
        {label}
        {sortsBy ? <span className="sr-only">, sorts by {sortsBy}</span> : null}
        <SortGlyph ariaSort={ariaSort} />
      </button>
    </Th>
  );
}

/**
 * The arrow beside a sortable header's label.
 *
 * Decorative: `aria-sort` on the header cell carries the same information to
 * assistive technology, so repeating it in text would have it announced twice.
 * An unsorted column keeps the glyph in the layout and reveals it on hover or
 * keyboard focus, which is what advertises that the header is a control. The
 * group is named so a hovered ancestor elsewhere in the table cannot reveal it.
 *
 * @param ariaSort - The header cell's announced sort state.
 */
function SortGlyph({
  ariaSort,
}: {
  ariaSort: "ascending" | "descending" | "none";
}) {
  if (ariaSort === "none") {
    return (
      <ArrowUpDown
        aria-hidden="true"
        className="size-3.5 text-gray-400 opacity-0 transition-opacity group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100"
      />
    );
  }

  const Arrow = ariaSort === "ascending" ? ArrowUp : ArrowDown;

  return <Arrow aria-hidden="true" className="size-3.5 text-gray-600" />;
}
