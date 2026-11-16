/**
 * `List` wires its rows to the row checkboxes for "Select all".
 *
 * A row on a page that "Select all" did not list ticks only when `List` hands
 * the checkbox the page's rows (`pageItems`). The checkbox's own tests pass
 * those rows themselves, so only a test that mounts `List` notices when the
 * wiring is dropped.
 *
 * @see {@link file://./index.tsx}
 * @see {@link file://./bulk-actions/bulk-list-item-checkbox.tsx}
 */
import { act, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { List } from ".";
import type { ListItemData } from "./list-item";

// why: both hooks read the asset index's own settings; this list is a plain
// index, and neither flag changes which rows are ticked.
vi.mock("~/hooks/use-asset-index-freeze-column", () => ({
  useAssetIndexFreezeColumn: () => false,
}));
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: false }),
}));

// why: the sticky-header effect reads `thead.rows[0].cells`, which happy-dom
// does not provide. Only the ref is used by ListHeader; the real header and
// its checkbox still render.
vi.mock("~/components/assets/assets-index/use-advanced-sticky-header", () => ({
  useStickyHeaderPortal: () => ({
    originalHeaderRef: { current: null },
    stickyHeaderRef: { current: null },
    isSticky: false,
    coords: { top: 0, left: 0, width: 0, columnCoords: [] },
  }),
}));

/** Rows of page 2; "Select all" was clicked on page 1, so none is listed. */
const PAGE_TWO: ListItemData[] = [{ id: "p2-a" }, { id: "p2-b" }];

/** Renders a row's name so a test can find the row. */
function Row({ item }: { item: ListItemData }) {
  return <td>{item.id}</td>;
}

/** The path only the ticked `FakeCheckbox` draws. */
const TICK_PATH = 'path[d^="M14.6668"]';

describe("List with every result selected", () => {
  it("ticks rows that 'Select all' did not list", async () => {
    const store = createStore();
    const Stub = createRoutesStub([
      {
        path: "/things",
        Component: () => (
          <List ItemComponent={Row} bulkActions={<div />} title="Things" />
        ),
        loader: () => ({
          items: PAGE_TWO,
          totalItems: 22,
          perPage: 20,
          page: 2,
          totalPages: 2,
          search: null,
          modelName: { singular: "thing", plural: "things" },
        }),
      },
    ]);
    render(
      <Provider store={store}>
        <Stub initialEntries={["/things"]} />
      </Provider>
    );
    await screen.findByText("p2-a");
    // why: the selection atom resets itself on mount, so select after render.
    act(() => {
      store.set(selectedBulkItemsAtom, [
        { id: "p1-a" },
        { id: ALL_SELECTED_KEY },
      ]);
    });

    for (const id of ["p2-a", "p2-b"]) {
      const row = screen.getByText(id).closest("tr")!;
      expect(row.querySelector(TICK_PATH)).not.toBeNull();
    }
  });
});
