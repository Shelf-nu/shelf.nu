/**
 * Freeze Column Classes
 *
 * The sticky-cell class strings the advanced asset table pins its left-hand
 * columns with. They live in one module because a sticky cell only looks right
 * when its offset, its background and its faked borders agree, and each of
 * those is spelled at a different call site (the header, the checkbox, the name
 * cell).
 *
 * Two sets, keyed by what sits at the left edge of the table:
 *
 * - `checkbox*` / `name*` for the asset index, where the bulk-select column is
 *   the first cell and the name cell pins 48px in, beside it.
 * - `sheet*` for a table that renders no bulk-select column, where the name is
 *   the first cell and pins at the left edge.
 *
 * @see {@link file://./../../list/list-header.tsx} The index header row
 * @see {@link file://./advanced-asset-columns.tsx} The index name cell
 * @see {@link file://./asset-model-assets-sheet.tsx} The drill-down sheet
 */
import type { ClassNameValue } from "tailwind-merge";
import { tw } from "~/utils/tw";

export const freezeColumnClassNames: Record<
  | "checkbox"
  | "name"
  | "nameHeader"
  | "checkboxHeader"
  | "sheetNameHeader"
  | "sheetNameCells",
  ClassNameValue
> = {
  // Because sticky elements dont work with border, we use the after pseudo element to create the border
  checkboxHeader: tw(
    "sticky left-0 z-10 bg-gray-25",
    "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200 after:content-['']"
  ),
  checkbox: tw("sticky left-0 z-10 bg-white"),

  nameHeader: tw(
    "sticky left-[48px] z-10 bg-gray-25",
    "before:absolute before:inset-y-0 before:right-0 before:border-r before:content-['']",
    "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200 after:content-['']"
  ),
  name: tw(
    "freeze-shadow sticky left-[48px] z-10 bg-white",
    "after:absolute after:inset-y-0 after:right-[0.5px] after:border-r after:border-gray-200 after:content-['']"
    // "before:absolute before:inset-x-0 before:bottom-0 before:border-b before:border-gray-200 before:content-['']"
  ),

  // `left-0`, not `left-[48px]`: there is no checkbox column here for the name
  // to sit beside, so the 48px offset would float it clear of the left edge.
  // A sticky cell cannot draw its own border, so both borders are pseudo
  // elements, the same way the index's header cell does it.
  sheetNameHeader: tw(
    "sticky left-0 z-10 bg-gray-25",
    "before:absolute before:inset-y-0 before:right-0 before:border-r before:content-['']",
    "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200 after:content-['']"
  ),

  // Applied to the TABLE, not to a cell: the name cell of a row comes from the
  // shared `AdvancedIndexColumn`, which takes its class from the index's own
  // freeze setting. Selecting the first body cell from the table is what lets a
  // table outside the index pin that column without the index's offset.
  sheetNameCells: tw(
    "[&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-10 [&_tbody_td:first-child]:bg-white",
    "[&_tbody_td:first-child]:after:absolute [&_tbody_td:first-child]:after:inset-y-0 [&_tbody_td:first-child]:after:right-[0.5px] [&_tbody_td:first-child]:after:border-r [&_tbody_td:first-child]:after:border-gray-200 [&_tbody_td:first-child]:after:content-['']"
  ),
};
