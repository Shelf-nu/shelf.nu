/**
 * The header checkbox while "Select all N entries" is on.
 *
 * "Select all" stores `ALL_SELECTED_KEY` plus the rows of the page it was
 * clicked on. On any other page those listed rows can be fewer than the rows on
 * screen, so a count comparison alone reads "partial" while every row shows
 * ticked, and one click on the partial icon clears the whole selection.
 *
 * @see {@link file://./bulk-list-header.tsx}
 * @see {@link file://./bulk-list-item-checkbox.tsx} - ticks rows under the marker
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedBulkItemsAtom, selectionIsFormStateAtom } from "~/atoms/list";
import type { ListItemData } from "~/components/list/list-item";
import { ALL_SELECTED_KEY } from "~/utils/list";
import BulkListHeader from "./bulk-list-header";

// why: the header reads the loader only when no `items` are passed; every case
// here passes them, so a router context would add nothing.
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return { ...actual, useLoaderData: () => ({ items: [] }) };
});

// why: both hooks read the asset index's settings through a router context
// these tests do not mount; neither flag changes the header's state.
vi.mock("~/hooks/use-asset-index-freeze-column", () => ({
  useAssetIndexFreezeColumn: () => false,
}));
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: true }),
}));

/** A full page of 20 rows, none of which "Select all" listed. */
const FULL_PAGE: ListItemData[] = Array.from({ length: 20 }, (_, i) => ({
  id: `full-${i}`,
}));

/** What "Select all" stored after it was clicked on a 5-row last page. */
const SELECTED_ALL_FROM_SHORT_PAGE: ListItemData[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `short-${i}` })),
  { id: ALL_SELECTED_KEY },
];

/** The path only the ticked `FakeCheckbox` draws. */
const TICK_PATH = 'path[d^="M14.6668"]';

/** Prints the selection so a test can read what a click did. */
function SelectionProbe() {
  const selected = useAtomValue(selectedBulkItemsAtom);
  return (
    <div data-testid="selected">{selected.map((i) => i.id).join(",")}</div>
  );
}

/**
 * Mounts the header over `FULL_PAGE`, then applies the selection. The
 * selection atom resets itself on mount, so it is set after render.
 */
function renderHeader({ formState = false }: { formState?: boolean } = {}) {
  const store = createStore();
  render(
    <Provider store={store}>
      <table>
        <thead>
          <tr data-testid="header-row">
            <BulkListHeader items={FULL_PAGE} />
          </tr>
        </thead>
      </table>
      <SelectionProbe />
    </Provider>
  );
  act(() => {
    store.set(selectionIsFormStateAtom, formState);
    store.set(selectedBulkItemsAtom, SELECTED_ALL_FROM_SHORT_PAGE);
  });
  return store;
}

describe("BulkListHeader with every result selected", () => {
  it("renders ticked over a page with more rows than 'Select all' listed", () => {
    renderHeader();

    expect(
      screen.getByTestId("header-row").querySelector(TICK_PATH)
    ).not.toBeNull();
  });

  it("clears the whole selection on one click", () => {
    renderHeader();

    fireEvent.click(screen.getByTestId("header-row").querySelector("svg")!);

    expect(screen.getByTestId("selected")).toHaveTextContent(/^$/);
  });

  it("follows the listed count on a screen whose selection is saved", () => {
    // why: manage-* pickers tick only listed rows, so the header must agree.
    renderHeader({ formState: true });

    expect(
      screen.getByTestId("header-row").querySelector(TICK_PATH)
    ).toBeNull();
  });
});
