/**
 * Whether the current member may open the Archived and All views of an asset
 * list (issue #382).
 *
 * Read from the role policy, `assets.seeArchived`, the same field the loaders
 * check through `canViewArchivedAssets`, so the menu and the rows it governs
 * follow one rule. Seeing is not acting: a Manager sees archived assets so it
 * can tell why one is out of service, while archiving and reinstating stay on
 * `asset: archive` (see `useCanArchiveAssets`).
 *
 * @see {@link file://./use-can-archive-assets.ts}
 * @see {@link file://./../modules/asset/data.server.ts} `canViewArchivedAssets`
 */
import { useRoleAccess } from "~/hooks/use-role-access";

/**
 * @returns `true` when the member's role may see archived assets
 */
export function useCanViewArchivedAssets(): boolean {
  return useRoleAccess().policy.assets.seeArchived;
}
