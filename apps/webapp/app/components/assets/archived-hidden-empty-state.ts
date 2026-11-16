/**
 * Archived Hidden Empty State
 *
 * A kit's or a location's asset list shows active assets by default. When
 * every asset there is archived, the plain "No assets in this kit" is untrue:
 * the assets exist, outside the Active view. This builds the empty-state copy
 * that says where they went, worded like the asset index's search hint
 * (`components/list/empty-state.tsx`): members with the Archived view are pointed at
 * the Archived view, everyone else is told to ask an admin, since their role
 * has no such view.
 *
 * @see {@link file://./../../routes/_layout+/kits.$kitId.assets.tsx}
 * @see {@link file://./../../routes/_layout+/locations.$locationId.assets.tsx}
 */

/**
 * Empty-state copy for a kit or location list whose assets are all archived.
 *
 * @param args.archivedCount - Archived assets in the kit or at the location
 * @param args.canViewArchivedAssets - Whether the reader has the Archived view
 * @param args.place - Which list this is, for the title
 * @returns `{ title, text }`, or `null` when nothing archived is hidden (the
 *   list's own empty state applies)
 */
export function archivedHiddenEmptyState({
  archivedCount,
  canViewArchivedAssets,
  place,
}: {
  archivedCount: number;
  canViewArchivedAssets: boolean;
  place: "kit" | "location";
}): { title: string; text: string } | null {
  if (archivedCount <= 0) return null;

  const where = place === "kit" ? "in this kit" : "at this location";
  const one = archivedCount === 1;

  return {
    title: `No active assets ${where}`,
    text: canViewArchivedAssets
      ? `${archivedCount} archived ${
          one ? "asset is" : "assets are"
        } hidden from this view. Pick Archived from the menu on the list title to see ${
          one ? "it" : "them"
        }.`
      : "Archived assets are hidden from your view. Ask an admin to check.",
  };
}
