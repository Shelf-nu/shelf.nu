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
 * - add to booking — assets: already in this booking / part of a kit / not
 *   available to book / checked out (only when the booking is
 *   ONGOING/OVERDUE); kits: contains unavailable assets / checked out
 *   (only when the booking is ONGOING/OVERDUE)
 *
 * @see {@link file://./../components/scanner/batch-blockers.tsx} UI renderer
 * @see {@link file://./../app/(tabs)/scanner.tsx} integration
 */

/** Batch actions that submit a scanned list (the "view" action is excluded). */
export type BatchScanAction =
  | "assign_custody"
  | "release_custody"
  | "update_location"
  | "booking_add";

/** The minimal item shape blocker rules need (assets and kits). */
export type BlockableItem = {
  qrId: string;
  type: "asset" | "kit";
  /** Asset id for type=asset, kit id for type=kit. */
  targetId: string;
  title: string;
  status: string;
  /** Assets only: id of the kit the asset belongs to (null otherwise). */
  kitId: string | null;
  /** Kits only: true when any contained asset is individually in custody. */
  hasAssetsInCustody?: boolean;
  /** Assets only: false when the asset is marked unavailable to book. */
  availableToBook?: boolean;
  /** Kits only: true when any contained asset is unavailable to book. */
  hasUnavailableAssets?: boolean;
};

/** Booking context for the `booking_add` action's rules. */
export type BookingBlockerContext = {
  /** Asset ids already in the target booking. */
  bookedAssetIds: ReadonlySet<string>;
  /** The target booking's status (gates the checked-out blockers). */
  bookingStatus: string;
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
    | "kit-not-in-custody"
    | "asset-already-in-booking"
    | "asset-not-bookable"
    | "asset-checked-out-for-booking"
    | "kit-has-unavailable-assets"
    | "kit-checked-out-for-booking";
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
  items: BlockableItem[],
  /** Required for the `booking_add` action; ignored otherwise. */
  bookingCtx?: BookingBlockerContext
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
  } else if (action === "booking_add" && bookingCtx) {
    // Mirrors the web add-assets-to-booking drawer exactly — including that
    // checked-out items only block when the booking itself is checked out
    // (ONGOING/OVERDUE), and that there is no kit-already-in-booking rule.
    const bookingIsCheckedOut = ["ONGOING", "OVERDUE"].includes(
      bookingCtx.bookingStatus
    );

    push(
      "asset-already-in-booking",
      assets.filter((i) => bookingCtx.bookedAssetIds.has(i.targetId)),
      (n) => `${countNoun(n, "asset")} already in this booking.`
    );
    push(
      "asset-part-of-kit",
      assets.filter((i) => i.kitId !== null),
      (n) =>
        `${countNoun(
          n,
          "asset"
        )} part of a kit. Scan the kit to add it as a whole.`
    );
    push(
      "asset-not-bookable",
      assets.filter((i) => i.availableToBook === false),
      (n) => `${countNoun(n, "asset")} marked as unavailable to book.`
    );
    push(
      "kit-has-unavailable-assets",
      kits.filter((i) => i.hasUnavailableAssets === true),
      (n) =>
        `${countNoun(n, "kit")} holding assets that are unavailable to book.`
    );
    if (bookingIsCheckedOut) {
      push(
        "asset-checked-out-for-booking",
        assets.filter((i) => i.status === "CHECKED_OUT"),
        (n) =>
          `${countNoun(
            n,
            "asset"
          )} checked out and cannot join a checked-out booking.`
      );
      push(
        "kit-checked-out-for-booking",
        kits.filter((i) => i.status === "CHECKED_OUT"),
        (n) =>
          `${countNoun(
            n,
            "kit"
          )} checked out and cannot join a checked-out booking.`
      );
    }
  }
  // update_location: no eligibility blockers — any scanned item can move.

  return groups;
}

/** All qrIds blocked by any group, deduplicated. */
export function blockedQrIds(groups: BlockerGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.qrIds));
}
