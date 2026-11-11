/**
 * Row checkboxes while "Select all N entries" is on.
 *
 * "Select all" does not list the ids of rows on other pages: it adds the
 * `ALL_SELECTED_KEY` marker, and the server resolves every row that matches the
 * list's filters. The row checkbox has to read that marker too, or every row
 * past the page where "Select all" was clicked shows unticked while the bulk
 * action still applies to it, and the selection looks like it did not reach
 * the other pages.
 *
 * @see {@link file://./bulk-list-item-checkbox.tsx}
 * @see {@link file://./../list-title.tsx}: where "Select all" sets the marker
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { disabledBulkItemsAtom, selectedBulkItemsAtom } from "~/atoms/list";
import type { ListItemData } from "~/components/list/list-item";
import { ALL_SELECTED_KEY } from "~/utils/list";
import BulkListItemCheckbox from "./bulk-list-item-checkbox";

// why: both hooks read the asset index's settings through a router context
// these tests do not mount; neither flag changes what is ticked.
vi.mock("~/hooks/use-asset-index-freeze-column", () => ({
  useAssetIndexFreezeColumn: () => false,
}));
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: true }),
}));

/** Rows of the page on screen (page 2: none of them were listed). */
const PAGE_TWO: ListItemData[] = [
  { id: "p2-a" },
  { id: "p2-b" },
  { id: "p2-c" },
];

/** What "Select all" stored after it was clicked on page 1. */
const SELECTED_ALL_FROM_PAGE_ONE: ListItemData[] = [
  { id: "p1-a" },
  { id: "p1-b" },
  { id: ALL_SELECTED_KEY },
];

/** Prints the selection so a test can read what a click did. */
function SelectionProbe() {
  const selected = useAtomValue(selectedBulkItemsAtom);
  return (
    <div data-testid="selected">{selected.map((i) => i.id).join(",")}</div>
  );
}

/**
 * Mounts page 2's rows as the list does, then applies the selection. The
 * selection atom resets itself on mount, so it is set after render.
 */
function renderPageTwo({
  selected,
  disabled = [],
}: {
  selected: ListItemData[];
  disabled?: ListItemData[];
}) {
  const store = createStore();
  render(
    <Provider store={store}>
      <table>
        <tbody>
          {PAGE_TWO.map((row) => (
            <tr key={row.id} data-testid={`row-${row.id}`}>
              <BulkListItemCheckbox item={row} pageItems={PAGE_TWO} />
            </tr>
          ))}
        </tbody>
      </table>
      <SelectionProbe />
    </Provider>
  );
  act(() => {
    store.set(disabledBulkItemsAtom, disabled);
    store.set(selectedBulkItemsAtom, selected);
  });
  return store;
}

/** Whether the row's fake checkbox is drawn ticked (only ticked draws a path). */
function isTicked(rowId: string) {
  return !!screen.getByTestId(`row-${rowId}`).querySelector("svg path");
}

describe("BulkListItemCheckbox with every result selected", () => {
  it("ticks rows on a page that 'Select all' did not list", () => {
    renderPageTwo({ selected: SELECTED_ALL_FROM_PAGE_ONE });

    expect(PAGE_TWO.map((row) => isTicked(row.id))).toEqual([true, true, true]);
  });

  it("leaves a disabled row unticked", () => {
    renderPageTwo({
      selected: SELECTED_ALL_FROM_PAGE_ONE,
      disabled: [{ id: "p2-b" }],
    });

    expect(isTicked("p2-a")).toBe(true);
    expect(isTicked("p2-b")).toBe(false);
  });

  it("unticking one row keeps the rest of the page ticked", () => {
    renderPageTwo({ selected: SELECTED_ALL_FROM_PAGE_ONE });

    fireEvent.click(screen.getByTestId("row-p2-b").querySelector("td")!);

    // why: the selection cannot say "everything except this row", so it
    // falls back to what the reader sees: this page, minus the row they
    // unticked. Keeping the marker would still act on the unticked row.
    expect(screen.getByTestId("selected")).toHaveTextContent(/^p2-a,p2-c$/);
    expect(isTicked("p2-a")).toBe(true);
    expect(isTicked("p2-b")).toBe(false);
  });

  it("ticks only listed rows when not everything is selected", () => {
    renderPageTwo({ selected: [{ id: "p2-a" }] });

    expect(isTicked("p2-a")).toBe(true);
    expect(isTicked("p2-b")).toBe(false);
  });
});
