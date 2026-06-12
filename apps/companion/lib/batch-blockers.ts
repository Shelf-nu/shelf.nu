/**
 * Batch-scan blocker rules.
 *
 * The webapp's bulk services are all-or-nothing: one ineligible item fails
 * the entire batch (e.g. `bulkAssignCustody` throws if any asset is not
 * AVAILABLE). The web scanner prevents this with client-side "blockers"
 * (see webapp `components/scanner/drawer/blockers-factory.tsx` and the
 * per-action drawers) that force conflicted items out of the list before
 * submit. This module is the companion-app port of those rules: a pure
 * function from (action, scanned items) to a list of blocker groups the UI
 * renders above the submit button.
 *
 * Rules mirror the web drawers exactly, for both entity types:
 * - assign custody — assets: already in custody / checked out / part of a
 *   kit; kits: already in custody / checked out / has assets in custody
 * - release custody — assets: not in custody / part of a kit; kits: not in
 *   custody
 * - update location — no eligibility blockers
 *
 * @see {@link file://./../components/scanner/batch-blockers.tsx} UI renderer
 * @see {@link file://./../app/(tabs)/scanner.tsx} integration
 */

/** Batch actions that submit a scanned list (the "view" action is excluded). */
export type BatchScanAction =
  | "assign_custody"
  | "release_custody"
  | "update_location";

/** The minimal item shape blocker rules need (assets and kits). */
export type BlockableItem = {
  qrId: string;
  type: "asset" | "kit";
  title: string;
  status: string;
  /** Assets only: id of the kit the asset belongs to (null otherwise). */
  kitId: string | null;
  /** Kits only: true when any contained asset is individually in custody. */
  hasAssetsInCustody?: boolean;
};

/** A group of items blocked for the same reason, with copy ready to render. */
export type BlockerGroup = {
  key:
    | "asset-in-custody"
    | "asset-checked-out"
    | "asset-part-of-kit"
    | "asset-not-in-custody"
    | "kit-in-custody"
    | "kit-checked-out"
    | "kit-has-assets-in-custody"
    | "kit-not-in-custody";
  /** qrIds of the affected items — used to remove them from the scan list. */
  qrIds: string[];
  message: string;
};

/** "3 assets are" / "1 kit is" — shared by all blocker messages. */
function countNoun(n: number, noun: "asset" | "kit") {
  return n === 1 ? `1 ${noun} is` : `${n} ${noun}s are`;
}

/**
 * Computes the blocker groups for the current action and scan list.
 * Returns an empty array when every item is eligible (submit may proceed).
 * An item can appear in more than one group (e.g. checked out AND in a kit);
 * resolving either group removes it from the list, which clears both.
 */
export function computeBlockers(
  action: BatchScanAction,
  items: BlockableItem[]
): BlockerGroup[] {
  const groups: BlockerGroup[] = [];
  const assets = items.filter((i) => i.type === "asset");
  const kits = items.filter((i) => i.type === "kit");

  const push = (
    key: BlockerGroup["key"],
    affected: BlockableItem[],
    message: (n: number) => string
  ) => {
    if (affected.length > 0) {
      groups.push({
        key,
        qrIds: affected.map((i) => i.qrId),
        message: message(affected.length),
      });
    }
  };

  if (action === "assign_custody") {
    push(
      "asset-in-custody",
      assets.filter((i) => i.status === "IN_CUSTODY"),
      (n) => `${countNoun(n, "asset")} already in custody.`
    );
    push(
      "asset-checked-out",
      assets.filter((i) => i.status === "CHECKED_OUT"),
      (n) =>
        `${countNoun(
          n,
          "asset"
        )} checked out. Checked-out assets cannot be assigned custody.`
    );
    push(
      "asset-part-of-kit",
      assets.filter((i) => i.kitId !== null),
      (n) =>
        `${countNoun(
          n,
          "asset"
        )} part of a kit. Scan the kit to assign it as a whole.`
    );
    push(
      "kit-in-custody",
      kits.filter((i) => i.status === "IN_CUSTODY"),
      (n) => `${countNoun(n, "kit")} already in custody.`
    );
    push(
      "kit-checked-out",
      kits.filter((i) => i.status === "CHECKED_OUT"),
      (n) =>
        `${countNoun(
          n,
          "kit"
        )} checked out. Checked-out kits cannot be assigned custody.`
    );
    push(
      "kit-has-assets-in-custody",
      kits.filter(
        (i) => i.status !== "IN_CUSTODY" && i.hasAssetsInCustody === true
      ),
      (n) =>
        `${countNoun(n, "kit")} holding assets that are already in custody.`
    );
  } else if (action === "release_custody") {
    push(
      "asset-not-in-custody",
      assets.filter((i) => i.status !== "IN_CUSTODY"),
      (n) =>
        `${countNoun(
          n,
          "asset"
        )} not in custody, so there is nothing to release.`
    );
    push(
      "asset-part-of-kit",
      assets.filter((i) => i.kitId !== null && i.status === "IN_CUSTODY"),
      (n) =>
        `${countNoun(
          n,
          "asset"
        )} part of a kit. Scan the kit to release it as a whole.`
    );
    push(
      "kit-not-in-custody",
      kits.filter((i) => i.status !== "IN_CUSTODY"),
      (n) =>
        `${countNoun(n, "kit")} not in custody, so there is nothing to release.`
    );
  }
  // update_location: no eligibility blockers — any scanned item can move.

  return groups;
}

/** All qrIds blocked by any group, deduplicated. */
export function blockedQrIds(groups: BlockerGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.qrIds));
}
