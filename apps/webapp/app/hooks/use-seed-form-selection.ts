/**
 * Seed-once selection for `manage-*` pickers.
 *
 * A picker pre-ticks the items already attached to its entity (a booking, kit
 * or location) and submits anything unticked as removed. The seed has to run
 * exactly once per entity: the route's loader revalidates on every filter
 * change and hands back a new array of the same attached items, and seeding
 * from it again would re-tick whatever the user had unticked.
 *
 * @see {@link file://./../atoms/list.ts} — `seedFormSelectionAtom`
 * @see {@link file://./../atoms/atoms-reset-handler.tsx} — clears the selection
 *      on a pathname change, before the route renders and seeds
 */
import { useRef } from "react";
import { useSetAtom } from "jotai";
import { seedFormSelectionAtom } from "~/atoms/list";
import type { ListItemData } from "~/components/list/list-item";

/**
 * Pre-ticks `attachedItems` the first time the picker renders for `entityId`,
 * and again only if `entityId` changes.
 *
 * Runs during render, not in an effect, so the seed lands after
 * `AtomsResetHandler` (rendered above the route) has done its pathname reset
 * and before the first paint shows an empty picker.
 *
 * @param entityId - The id of the booking, kit or location being managed
 * @param attachedItems - The items currently attached to that entity
 */
export function useSeedFormSelection(
  entityId: string,
  attachedItems: ListItemData[]
) {
  const seedFormSelection = useSetAtom(seedFormSelectionAtom);
  const seededForRef = useRef<string | undefined>(undefined);

  if (seededForRef.current !== entityId) {
    seededForRef.current = entityId;
    seedFormSelection(attachedItems);
  }
}
