/**
 * Empty-state copy for the asset index, per Active/Archived/All view.
 *
 * The Archived view needs its own: falling through to the default would either
 * blame filters the user never applied, or urge someone with a full inventory
 * to "create your first asset". Neither is true, and the archived one is the
 * moment a worried user most needs to be told their asset is safe.
 *
 * @see {@link file://./../../../routes/_layout+/assets._index.tsx}
 */
/**
 * Builds the asset index's empty-state content.
 *
 * @param args.archivedView - The `archived` search param (`"archived"`, `"all"` or none)
 * @param args.canImportAssets - Whether this member may import, from the loader
 * @returns The `customContent` the asset index passes to `EmptyState`
 */
export function assetsEmptyStateContent({
  archivedView,
  canImportAssets,
}: {
  archivedView: string | null;
  canImportAssets: boolean;
}) {
  if (archivedView === "archived") {
    return {
      title: "Nothing archived",
      text: "Archiving hides an asset from your lists and reports without deleting it. Its history, ID and QR code stay intact, and you can reinstate it at any time.",
    };
  }

  return {
    title: "No assets yet",
    text: "Assets are the core of your inventory. Create your first asset to start tracking equipment, devices, or anything your team manages.",
    newButtonRoute: "/assets/new",
    newButtonContent: "Create your first asset",
    // The import page refuses members whose plan or role cannot import.
    secondaryButton: canImportAssets
      ? { route: "/assets/import", content: "Import a spreadsheet" }
      : undefined,
  };
}
