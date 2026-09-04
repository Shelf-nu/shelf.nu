import { atom } from "jotai";
import type { ListItemData } from "~/components/list/list-item";

/**
 * Unique key for bulk-selection identity.
 *
 * A single asset can have multiple BookingAsset rows on the same booking
 * (Polish-6 multi-slice — e.g. one slice as a kit member + one standalone
 * slice of the same qty-tracked asset). Both rows carry the same `id`
 * (asset id) but different `bookingAssetId`. Comparing by `id` alone
 * treats them as the same selection, so checking the kit auto-checks any
 * standalone-of-same-asset row (and vice versa) — and removing one
 * removes both.
 *
 * Prefer `bookingAssetId` when present (per-slice rows on a booking), fall
 * back to `id` (kits, assets that don't have a pivot row attached — e.g.
 * the asset index page, ALL_SELECTED_KEY sentinel, etc.).
 */
export function bulkSelectionKey(
  item: { id: string } & {
    bookingAssetId?: string | null;
  }
): string {
  return item.bookingAssetId ?? item.id;
}

export const selectedBulkItemsAtom = atom<ListItemData[]>([]);

// This atom is used to keep track of the items that are disabled in the bulk actions
export const disabledBulkItemsAtom = atom<ListItemData[]>([]);

/**
 * Whether the current route's selection is FORM STATE rather than a set of rows
 * to act on.
 *
 * On an index, a tick means "do the next bulk action to this row", so it must
 * not outlive the filter it was made under: an item ticked before a search
 * stays selected while invisible, and the action then reaches an asset the user
 * cannot see. On the `manage-*` screens a tick means "this item is attached to
 * this booking or kit", so it MUST survive filtering — unticking is how you
 * detach something, and clearing on search would submit every attached item as
 * removed.
 *
 * Default false, so a new list page is protected without having to remember
 * anything. The three screens where the selection is form state opt out where
 * they seed it. `AtomsResetHandler` resets this on every pathname change, so an
 * opt-out cannot leak into the next route.
 */
export const selectionIsFormStateAtom = atom<boolean>(false);

/**
 * Reset the atom when it mounts
 * This item is also reset in the atoms-reset-handler.tsx file
 * This is just in case the atom is used in a component that does not change route
 * */
selectedBulkItemsAtom.onMount = (setAtom) => {
  setAtom([]);
};

/* This atom is used to keep track of the number of selected items */
export const selectedBulkItemsCountAtom = atom((get) => {
  const selectedItems = get(selectedBulkItemsAtom);
  const kits = selectedItems.filter((i) => "_count" in i);
  const kitIds = kits.map((kit) => kit.id);

  const count = selectedItems.filter((item) => {
    if ("_count" in item) return true; // count kits
    if (!item.kitId) return true; // count assets without a kit
    if (item.kitId && !kitIds.includes(item.kitId)) return true; // count assets with a kit that's not selected
    return false;
  }).length;

  return count;
});
/**
 * Set an item in selectedBulkItems
 */
export const setSelectedBulkItemAtom = atom<null, ListItemData[], unknown>(
  null,
  (_, set, update) => {
    set(selectedBulkItemsAtom, (prev) => {
      // Compare by `bulkSelectionKey` so multi-slice rows (kit-driven +
      // standalone of the same asset) toggle independently — see helper
      // for rationale.
      const updateKey = bulkSelectionKey(update);
      const exists = prev.some((item) => bulkSelectionKey(item) === updateKey);

      if (exists) {
        return prev.filter((item) => bulkSelectionKey(item) !== updateKey);
      }
      return [...prev, update];
    });
  }
);

/**
 * Set multiple items at once in selectedBulkItems
 */
export const setSelectedBulkItemsAtom = atom<null, ListItemData[][], void>(
  null,
  (get, set, update) => {
    const disabledItems = get(disabledBulkItemsAtom);
    const prevItems = get(selectedBulkItemsAtom);

    // Filter out disabled items from the update — compare by
    // `bulkSelectionKey` so multi-slice rows are evaluated per-row.
    const disabledKeys = new Set(disabledItems.map(bulkSelectionKey));
    const filteredUpdate = update.filter(
      (item) => !disabledKeys.has(bulkSelectionKey(item))
    );

    // Dedup-merge prev + filteredUpdate keyed by `bulkSelectionKey`.
    const prevItemsMap = new Map(
      prevItems.map((item) => [bulkSelectionKey(item), item])
    );
    filteredUpdate.forEach((item) => {
      prevItemsMap.set(bulkSelectionKey(item), item);
    });

    set(selectedBulkItemsAtom, Array.from(prevItemsMap.values()));
  }
);

/**
 * Set multiple items at once in disabledBulkItems
 * This is used to disable items in the bulk actions
 */
export const setDisabledBulkItemsAtom = atom<null, ListItemData[][], void>(
  null,
  (_, set, update) => {
    set(disabledBulkItemsAtom, update);
  }
);

/**
 * Remove the items from selectedBulkItemsAtom
 */
export const removeSelectedBulkItemsAtom = atom<null, ListItemData[][], void>(
  null,
  (_, set, update) => {
    // Per-row removal: compare by `bulkSelectionKey` so removing a
    // kit-driven slice doesn't also pull a standalone-of-same-asset row
    // out of the selection (multi-slice).
    const updateKeys = new Set(update.map(bulkSelectionKey));
    set(selectedBulkItemsAtom, (prev) =>
      prev.filter((prevItem) => !updateKeys.has(bulkSelectionKey(prevItem)))
    );
  }
);

/**
 * Clears selected bulk items
 */
export const clearSelectedBulkItemsAtom = atom<null, [], void>(
  null,
  (_, set) => {
    set(selectedBulkItemsAtom, []);
  }
);
