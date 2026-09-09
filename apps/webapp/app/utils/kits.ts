/**
 * Pure helpers over kit list rows.
 *
 * These operate on rows as the kits index loader supplies them, where kit
 * membership arrives as `AssetKit` pivot rows rather than a flat asset array.
 * They live here rather than inline in a component because the rows reach the
 * UI through `selectedBulkItemsAtom`, whose `ListItemData` is
 * `{ id: string; [x: string]: any }` — an index signature that types every
 * field access as `any`. Reading the payload through a declared parameter type
 * is the only way the compiler can check these field names at all.
 *
 * @see {@link file://./../routes/_layout+/kits._index.tsx} — supplies `assetKits`
 * @see {@link file://./../components/kits/bulk-actions-dropdown.tsx} — consumer
 */

import type { AssetStatus } from "@prisma/client";

/** Statuses that make a kit member ineligible for a custody assignment. */
const CUSTODY_BLOCKING_ASSET_STATUSES: AssetStatus[] = [
  "CHECKED_OUT",
  "IN_CUSTODY",
];

/**
 * A kit list row, narrowed to the membership the custody guard reads.
 *
 * `assetKits` is optional because "select all across pages" selects rows the
 * client never loaded; see {@link someKitMemberBlocksCustodyAssignment}.
 */
export type KitRowWithMemberStatuses = {
  id: string;
  assetKits?: { asset: { status: AssetStatus } }[];
};

/**
 * Whether any member asset of the given kits is checked out or in custody.
 *
 * Assigning custody of a kit assigns custody of its members, so a member that
 * is already checked out or held by someone else has to be resolved first. The
 * UI uses this to disable "Assign custody" with an explanation instead of
 * letting the request fail server-side.
 *
 * A row with no `assetKits` contributes `false`. That is correct only because
 * the server re-validates: under "select all", the client holds rows it never
 * fetched, so this can only ever be an affordance, never the enforcement.
 *
 * @param kits - The selected kit rows, as the kits index loader supplies them
 * @returns `true` if at least one member asset blocks a custody assignment
 */
export function someKitMemberBlocksCustodyAssignment(
  kits: KitRowWithMemberStatuses[]
): boolean {
  return kits.some(
    (kit) =>
      kit.assetKits?.some((assetKit) =>
        CUSTODY_BLOCKING_ASSET_STATUSES.includes(assetKit.asset.status)
      )
  );
}
