/**
 * Batch-scan blocker rules.
 *
 * The webapp's bulk services are all-or-nothing: one ineligible asset fails
 * the entire batch (e.g. `bulkAssignCustody` throws if any asset is not
 * AVAILABLE). The web scanner prevents this with client-side "blockers"
 * (see webapp `components/scanner/drawer/blockers-factory.tsx` and the
 * per-action drawers) that force conflicted items out of the list before
 * submit. This module is the companion-app port of those rules: a pure
 * function from (action, scanned items) to a list of blocker groups the UI
 * renders above the submit button.
 *
 * Rules mirror the web drawers exactly:
 * - assign custody: already in custody / checked out / part of a kit
 * - release custody: not in custody / part of a kit
 * - update location: no eligibility blockers (web parity)
 *
 * @see {@link file://./../components/scanner/batch-blockers.tsx} UI renderer
 * @see {@link file://./../app/(tabs)/scanner.tsx} integration
 */

/** Batch actions that submit a scanned list (the "view" action is excluded). */
export type BatchScanAction =
  | "assign_custody"
  | "release_custody"
  | "update_location";

/** The minimal item shape blocker rules need. */
export type BlockableItem = {
  qrId: string;
  title: string;
  status: string;
  kitId: string | null;
};

/** A group of items blocked for the same reason, with copy ready to render. */
export type BlockerGroup = {
  key: "in-custody" | "checked-out" | "part-of-kit" | "not-in-custody";
  /** qrIds of the affected items — used to remove them from the scan list. */
  qrIds: string[];
  message: string;
};

/** "3 assets are" / "1 asset is" — shared by all blocker messages. */
function assetCount(n: number) {
  return n === 1 ? "1 asset is" : `${n} assets are`;
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
      "in-custody",
      items.filter((i) => i.status === "IN_CUSTODY"),
      (n) => `${assetCount(n)} already in custody.`
    );
    push(
      "checked-out",
      items.filter((i) => i.status === "CHECKED_OUT"),
      (n) =>
        `${assetCount(
          n
        )} checked out. Checked-out assets cannot be assigned custody.`
    );
    push(
      "part-of-kit",
      items.filter((i) => i.kitId !== null),
      (n) =>
        `${assetCount(n)} part of a kit. Kit custody is managed as a whole.`
    );
  } else if (action === "release_custody") {
    push(
      "not-in-custody",
      items.filter((i) => i.status !== "IN_CUSTODY"),
      (n) => `${assetCount(n)} not in custody, so there is nothing to release.`
    );
    push(
      "part-of-kit",
      items.filter((i) => i.kitId !== null && i.status === "IN_CUSTODY"),
      (n) =>
        `${assetCount(n)} part of a kit. Kit custody is managed as a whole.`
    );
  }
  // update_location: no eligibility blockers — any scanned asset can move.

  return groups;
}

/** All qrIds blocked by any group, deduplicated. */
export function blockedQrIds(groups: BlockerGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.qrIds));
}
