/**
 * The model view's "No model" row: on screen, never selectable.
 *
 * Two halves have to hold together, and asserting either alone passes over a
 * broken view. The bucket must RENDER — it is what answers "which of my assets
 * have no model assigned", and dropping it from the list would satisfy a
 * selection test while deleting the information the view exists to show. And
 * its checkbox must refuse, because the bucket is not a model and has no units
 * to reserve.
 *
 * The rows are mounted the way the model view composes them — the shared
 * checkbox cell beside `AssetModelRow` — rather than through `AssetsList`,
 * which needs the entire asset-index loader to render at all. Everything under
 * test here is real: the disabled registration, the atom, and the checkbox's
 * own refusal.
 *
 * happy-dom applies no CSS, so nothing here says anything about how the
 * refusing checkbox looks.
 *
 * @see {@link file://./unselectable-model-rows.ts}
 * @see {@link file://./../assets-list.tsx}
 */
import { useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider, useAtomValue, useSetAtom } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
  disabledBulkItemsAtom,
  selectedBulkItemsAtom,
  setDisabledBulkItemsAtom,
} from "~/atoms/list";
import BulkListItemCheckbox from "~/components/list/bulk-actions/bulk-list-item-checkbox";
import type { AssetModelRollupRow } from "~/modules/asset-model/rollup.server";
import { AssetModelRow } from "../asset-model-row";
import { getUnselectableModelRows } from "./unselectable-model-rows";

// why: both hooks read the asset index's loader data through a router context
// these component tests deliberately don't mount, and neither the checkbox's
// refusal nor the row's text depends on the frozen-column or mode flags.
vi.mock("~/hooks/use-asset-index-freeze-column", () => ({
  useAssetIndexFreezeColumn: () => false,
}));
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: true }),
}));

// why: the drill-down sheet fetches a model's assets from a route and has its
// own coverage; the row's identity is all these tests read.
vi.mock("../asset-model-assets-sheet", () => ({
  AssetModelAssetsSheet: ({ matchingAssets }: { matchingAssets: number }) => (
    <span>{matchingAssets} assets</span>
  ),
}));

// why: the preview resolves signed image URLs and opens a dialog, neither of
// which the no-model bucket even renders.
vi.mock("../../../image-with-preview/image-with-preview", () => ({
  default: () => <div />,
}));

/** A rollup row as `assets-list.tsx` hands it to the list: keyed by `id`. */
type ModelViewRow = AssetModelRollupRow & { id: string };

/** Stable stand-in for the list's bulk-action toolbar. */
const BULK_ACTIONS = <div />;

/**
 * A rollup row with the fields every case shares, so each case states only
 * what it is about.
 *
 * @param overrides - The fields under test; `assetModelId` decides the bucket
 * @returns One row of the model view
 */
function modelRow(overrides: Partial<ModelViewRow> = {}): ModelViewRow {
  const assetModelId = overrides.assetModelId ?? null;

  return {
    assetModelId,
    name: null,
    description: null,
    image: null,
    thumbnailImage: null,
    defaultCategoryId: null,
    defaultCategoryName: null,
    defaultCategoryColor: null,
    matchingAssets: 3,
    available: 3,
    checkedOut: 0,
    inCustody: 0,
    notBookable: 0,
    totalValue: 0,
    ...overrides,
    id: overrides.id ?? assetModelId ?? "no-model",
  };
}

/** Prints the two atoms so a test can read what the click did. */
function SelectionProbe() {
  const selected = useAtomValue(selectedBulkItemsAtom);
  const disabled = useAtomValue(disabledBulkItemsAtom);

  return (
    <>
      <div data-testid="selected">{selected.map((i) => i.id).join(",")}</div>
      <div data-testid="disabled">{disabled.map((i) => i.id).join(",")}</div>
    </>
  );
}

/**
 * The model view's rows, composed as the list composes them.
 *
 * @param rows - Every row the view renders, in render order
 * @returns The rows plus a probe over the selection atoms
 */
function ModelViewRows({ rows }: { rows: ModelViewRow[] }) {
  const setDisabledBulkItems = useSetAtom(setDisabledBulkItemsAtom);

  useEffect(() => {
    setDisabledBulkItems(getUnselectableModelRows(rows));
  }, [rows, setDisabledBulkItems]);

  return (
    <>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-testid={`row-${row.id}`}>
              <BulkListItemCheckbox item={row} />
              <AssetModelRow item={row} bulkActions={BULK_ACTIONS} />
            </tr>
          ))}
        </tbody>
      </table>
      <SelectionProbe />
    </>
  );
}

/**
 * Clicks the checkbox cell of one row — the first cell, as the list renders it.
 *
 * @param container - The rendered container
 * @param rowId - The row's `id`
 */
function clickCheckbox(container: HTMLElement, rowId: string) {
  const cell = container.querySelector(`[data-testid="row-${rowId}"] td`);
  if (!cell) {
    throw new Error(`No checkbox cell for row "${rowId}"`);
  }
  fireEvent.click(cell);
}

describe("model view selection", () => {
  const macbook = modelRow({ assetModelId: "am1", name: "MacBook" });
  const noModel = modelRow();

  it("renders the No model row and refuses to select it", () => {
    const { container } = render(
      <Provider>
        <ModelViewRows rows={[macbook, noModel]} />
      </Provider>
    );

    expect(screen.getByText("No model")).toBeInTheDocument();
    expect(screen.getByTestId("disabled")).toHaveTextContent("no-model");

    clickCheckbox(container, "no-model");
    expect(screen.getByTestId("selected").textContent).toBe("");

    clickCheckbox(container, "am1");
    expect(screen.getByTestId("selected").textContent).toBe("am1");
  });

  it("marks the no-model bucket, and only it, unselectable", () => {
    expect(getUnselectableModelRows([macbook, noModel])).toEqual([noModel]);
  });
});
