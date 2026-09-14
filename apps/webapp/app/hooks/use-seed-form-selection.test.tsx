/**
 * Tests for `useSeedFormSelection`, which pre-ticks a `manage-*` picker with
 * the items already attached to its entity.
 *
 * @see {@link file://./use-seed-form-selection.ts}
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import {
  selectedBulkItemsAtom,
  selectionIsFormStateAtom,
  setSelectedBulkItemAtom,
} from "~/atoms/list";
import { useSeedFormSelection } from "./use-seed-form-selection";

type Props = { entityId: string; items: { id: string }[] };

function setup(initialProps: Props) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(
    ({ entityId, items }: Props) => useSeedFormSelection(entityId, items),
    { initialProps, wrapper }
  );
  return {
    ...view,
    selectedIds: () => store.get(selectedBulkItemsAtom).map((item) => item.id),
    isFormState: () => store.get(selectionIsFormStateAtom),
    untick: (id: string) =>
      act(() => {
        // `setSelectedBulkItemAtom` toggles, so an item already selected is removed.
        store.set(setSelectedBulkItemAtom, { id });
      }),
  };
}

describe("useSeedFormSelection", () => {
  it("pre-ticks the attached items and marks the selection as form state", () => {
    const { selectedIds, isFormState } = setup({
      entityId: "location-1",
      items: [{ id: "kit-a" }, { id: "kit-b" }],
    });

    expect(selectedIds()).toEqual(["kit-a", "kit-b"]);
    expect(isFormState()).toBe(true);
  });

  it("does not re-tick an unticked item when the loader returns the same items again", () => {
    // A filter change revalidates the loader, which hands back a new array of the
    // same attached items. Re-seeding from it would re-tick the item, and the save
    // would silently keep it attached.
    const { rerender, untick, selectedIds } = setup({
      entityId: "location-1",
      items: [{ id: "kit-a" }, { id: "kit-b" }],
    });
    untick("kit-a");

    rerender({
      entityId: "location-1",
      items: [{ id: "kit-a" }, { id: "kit-b" }],
    });

    expect(selectedIds()).toEqual(["kit-b"]);
  });

  it("seeds again for a different entity", () => {
    const { rerender, selectedIds } = setup({
      entityId: "location-1",
      items: [{ id: "kit-a" }],
    });

    rerender({ entityId: "location-2", items: [{ id: "kit-z" }] });

    expect(selectedIds()).toContain("kit-z");
  });
});
