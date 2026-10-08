/**
 * Batch-scan blocker rules.
 *
 * A blocker is a scanned row's answer to "why can this not go". The webapp's
 * bulk services are all-or-nothing (one ineligible item fails the batch), and
 * a quantity-tracked row the server cannot act on is skipped or refused there.
 * So the scanner lists ineligible rows before submit, each group with a
 * one-tap "Remove", and the submit stays disabled until the list is clean.
 *
 * This is a pure function from (action, scanned items) to blocker groups. Each
 * group has a stable `key`; {@link blockerKeysFor} lists the keys an action can
 * raise, and `batch-blockers.test.ts` pins that list for the custody actions so
 * a new blocker cannot ship without a case.
 *
 * MIRROR of the web scanner drawers, cosmetic only (the server enforces every
 * rule on the write):
 * - assign / release custody:
 *   `apps/webapp/app/components/scanner/drawer/uses/custody-blockers.tsx`.
 *   Status and kit-membership blockers apply to INDIVIDUAL assets only:
 *   `Asset.status` is one flag for the whole row, so a quantity-tracked asset
 *   reads IN_CUSTODY or CHECKED_OUT while most of its units are free. A
 *   quantity row is judged by the units this mode can move instead.
 * - add to booking / fulfil: the web add-assets-to-booking drawer.
 * Extraction target: a pure `packages/*` scanner module (none yet).
 *
 * Rules by action:
 * - assign custody: quantity rows with no free units; INDIVIDUAL assets
 *   already in custody, checked out, or part of a kit; kits already in
 *   custody, checked out, or holding assets in custody.
 * - release custody: quantity rows held only through a kit, held by nobody,
 *   or held by more than one person; INDIVIDUAL assets not in custody or part
 *   of a kit; kits not in custody.
 * - update location: no eligibility blockers.
 * - add to booking / fulfil: assets already in this booking, part of a kit
 *   (add only: fulfil matches concrete units, so kit membership is no blocker
 *   there), not available to book, or checked out (only when the booking is
 *   ONGOING/OVERDUE); kits holding unavailable assets, or checked out (only
 *   when the booking is ONGOING/OVERDUE).
 *
 * @see {@link file://./custody-scan-quantities.ts} the units a quantity row can move
 * @see {@link file://./../components/scanner/batch-blockers.tsx} UI renderer
 * @see {@link file://./../app/(tabs)/scanner.tsx} integration
 */

import type { AssetType } from "./api/types";
import { unitsFor, type ScanQuantityFacts } from "./custody-scan-quantities";

/** Batch actions that submit a scanned list (the "view" action is excluded). */
export type BatchScanAction =
  | "assign_custody"
  | "release_custody"
  | "update_location"
  | "booking_add"
  | "booking_fulfil";

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
  /**
   * Assets only: the asset's type. Absent on servers that predate quantity
   * tracking, and then read as INDIVIDUAL.
   */
  assetType?: AssetType;
  /**
   * Quantity-tracked assets in the custody actions: the units this row can
   * move. A quantity row without it is treated as having none, so it is
   * blocked rather than sent with a guessed number.
   */
  quantityFacts?: ScanQuantityFacts;
};

/** Booking context for the `booking_add` / `booking_fulfil` rules. */
export type BookingBlockerContext = {
  /** Asset ids already in the target booking. */
  bookedAssetIds: ReadonlySet<string>;
  /** The target booking's status (gates the checked-out blockers). */
  bookingStatus: string;
};

/** Every blocker id, across all actions. */
type BlockerKey =
  | "qty-nothing-free"
  | "qty-held-via-kit"
  | "qty-nothing-held"
  | "qty-several-holders"
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

/** A group of items blocked for the same reason, with copy ready to render. */
export type BlockerGroup = {
  /** Stable id: what tests and the renderer key on. */
  key: BlockerKey;
  /** qrIds of the affected items, used to remove them from the scan list. */
  qrIds: string[];
  message: string;
};

/** A blocker an action can raise, before knowing whether any row raises it. */
type BlockerCandidate = {
  key: BlockerKey;
  /** The rows in this state. Empty when no row raises the blocker. */
  affected: BlockableItem[];
  message: (n: number) => string;
};

/** "3 assets are" / "1 kit is", shared by the blocker messages. */
function countNoun(n: number, noun: "asset" | "kit") {
  return n === 1 ? `1 ${noun} is` : `${n} ${noun}s are`;
}

/** "1 asset has" / "3 assets have". */
function countHave(n: number) {
  return n === 1 ? "1 asset has" : `${n} assets have`;
}

/**
 * True for a row the whole-row rules apply to: a kit member, or an asset whose
 * `status` describes the entire asset. A server that sends no type is read as
 * INDIVIDUAL.
 */
function isWholeAsset(item: BlockableItem): boolean {
  return item.type === "asset" && item.assetType !== "QUANTITY_TRACKED";
}

function isQuantityRow(item: BlockableItem): boolean {
  return item.type === "asset" && item.assetType === "QUANTITY_TRACKED";
}

/** Operator holders of a quantity row; none when its units are unknown. */
function holdersOf(item: BlockableItem) {
  return item.quantityFacts?.holders ?? [];
}

/**
 * Every blocker the action can raise, in display order, each with the rows
 * that raise it (possibly none).
 */
function candidatesFor(
  action: BatchScanAction,
  items: BlockableItem[],
  bookingCtx?: BookingBlockerContext
): BlockerCandidate[] {
  const assets = items.filter((i) => i.type === "asset");
  const wholeAssets = items.filter(isWholeAsset);
  const quantityRows = items.filter(isQuantityRow);
  const kits = items.filter((i) => i.type === "kit");

  if (action === "assign_custody") {
    return [
      {
        key: "qty-nothing-free",
        affected: quantityRows.filter(
          (i) =>
            !i.quantityFacts || unitsFor("assign_custody", i.quantityFacts) <= 0
        ),
        message: (n) =>
          `${countHave(
            n
          )} no units available. Every unit is in custody, in a kit, or out on a booking.`,
      },
      {
        key: "asset-in-custody",
        affected: wholeAssets.filter((i) => i.status === "IN_CUSTODY"),
        message: (n) => `${countNoun(n, "asset")} already in custody.`,
      },
      {
        key: "asset-checked-out",
        affected: wholeAssets.filter((i) => i.status === "CHECKED_OUT"),
        message: (n) =>
          `${countNoun(
            n,
            "asset"
          )} checked out. Checked-out assets cannot be assigned custody.`,
      },
      {
        key: "asset-part-of-kit",
        affected: wholeAssets.filter((i) => i.kitId !== null),
        message: (n) =>
          `${countNoun(
            n,
            "asset"
          )} part of a kit. Scan the kit to assign it as a whole.`,
      },
      {
        key: "kit-in-custody",
        affected: kits.filter((i) => i.status === "IN_CUSTODY"),
        message: (n) => `${countNoun(n, "kit")} already in custody.`,
      },
      {
        key: "kit-checked-out",
        affected: kits.filter((i) => i.status === "CHECKED_OUT"),
        message: (n) =>
          `${countNoun(
            n,
            "kit"
          )} checked out. Checked-out kits cannot be assigned custody.`,
      },
      {
        key: "kit-has-assets-in-custody",
        affected: kits.filter(
          (i) => i.status !== "IN_CUSTODY" && i.hasAssetsInCustody === true
        ),
        message: (n) =>
          `${countNoun(n, "kit")} holding assets that are already in custody.`,
      },
    ];
  }

  if (action === "release_custody") {
    // A release scan names no custodian: it takes the units back from whoever
    // holds them, so it is only unambiguous while exactly one person does.
    // The three quantity blockers split "cannot release" by cause because
    // the advice differs: go to the kit, there is nothing, or go to the asset.
    return [
      {
        key: "qty-held-via-kit",
        affected: quantityRows.filter(
          (i) =>
            holdersOf(i).length === 0 &&
            i.quantityFacts?.hasKitHeldUnits === true
        ),
        message: (n) =>
          `${countNoun(
            n,
            "asset"
          )} held through a kit. Scan the kit to release it.`,
      },
      {
        key: "qty-nothing-held",
        affected: quantityRows.filter(
          (i) =>
            holdersOf(i).length === 0 &&
            i.quantityFacts?.hasKitHeldUnits !== true
        ),
        message: (n) =>
          `${countHave(
            n
          )} no units in custody, so there is nothing to release.`,
      },
      {
        key: "qty-several-holders",
        affected: quantityRows.filter((i) => holdersOf(i).length > 1),
        message: (n) =>
          `${countNoun(
            n,
            "asset"
          )} held by more than one person. Release it from the asset page, where each holder is listed.`,
      },
      {
        key: "asset-not-in-custody",
        affected: wholeAssets.filter((i) => i.status !== "IN_CUSTODY"),
        message: (n) =>
          `${countNoun(
            n,
            "asset"
          )} not in custody, so there is nothing to release.`,
      },
      {
        key: "asset-part-of-kit",
        affected: wholeAssets.filter(
          (i) => i.kitId !== null && i.status === "IN_CUSTODY"
        ),
        message: (n) =>
          `${countNoun(
            n,
            "asset"
          )} part of a kit. Scan the kit to release it as a whole.`,
      },
      {
        key: "kit-not-in-custody",
        affected: kits.filter((i) => i.status !== "IN_CUSTODY"),
        message: (n) =>
          `${countNoun(
            n,
            "kit"
          )} not in custody, so there is nothing to release.`,
      },
    ];
  }

  if ((action === "booking_add" || action === "booking_fulfil") && bookingCtx) {
    // Mirrors the web add-assets-to-booking drawer, including that checked-out
    // items only block when the booking itself is checked out (ONGOING or
    // OVERDUE), and that there is no kit-already-in-booking rule.
    const bookingIsCheckedOut = ["ONGOING", "OVERDUE"].includes(
      bookingCtx.bookingStatus
    );

    const candidates: BlockerCandidate[] = [
      {
        key: "asset-already-in-booking",
        affected: assets.filter((i) =>
          bookingCtx.bookedAssetIds.has(i.targetId)
        ),
        message: (n) => `${countNoun(n, "asset")} already in this booking.`,
      },
    ];
    // Fulfil matches CONCRETE units against the booking's model lines, so an
    // asset that lives in a kit is a good scan there. The scan-the-kit rule
    // applies only to plain adds (the web fulfil drawer has no such rule).
    if (action === "booking_add") {
      candidates.push({
        key: "asset-part-of-kit",
        affected: assets.filter((i) => i.kitId !== null),
        message: (n) =>
          `${countNoun(
            n,
            "asset"
          )} part of a kit. Scan the kit to add it as a whole.`,
      });
    }
    candidates.push(
      {
        key: "asset-not-bookable",
        affected: assets.filter((i) => i.availableToBook === false),
        message: (n) =>
          `${countNoun(n, "asset")} marked as unavailable to book.`,
      },
      {
        key: "kit-has-unavailable-assets",
        affected: kits.filter((i) => i.hasUnavailableAssets === true),
        message: (n) =>
          `${countNoun(n, "kit")} holding assets that are unavailable to book.`,
      }
    );
    if (bookingIsCheckedOut) {
      candidates.push(
        {
          key: "asset-checked-out-for-booking",
          affected: assets.filter((i) => i.status === "CHECKED_OUT"),
          message: (n) =>
            `${countNoun(
              n,
              "asset"
            )} checked out and cannot join a checked-out booking.`,
        },
        {
          key: "kit-checked-out-for-booking",
          affected: kits.filter((i) => i.status === "CHECKED_OUT"),
          message: (n) =>
            `${countNoun(
              n,
              "kit"
            )} checked out and cannot join a checked-out booking.`,
        }
      );
    }
    return candidates;
  }

  // update_location: any scanned item can move.
  return [];
}

/**
 * The blocker ids an action can raise, in display order. Booking actions
 * depend on the booking's status, so they take its context.
 *
 * @param action - The batch action.
 * @param bookingCtx - Required for the booking actions.
 * @returns The ids, whether or not any row raises them now.
 */
export function blockerKeysFor(
  action: BatchScanAction,
  bookingCtx?: BookingBlockerContext
): BlockerKey[] {
  return candidatesFor(action, [], bookingCtx).map((c) => c.key);
}

/**
 * Computes the blocker groups for the current action and scan list.
 * Returns an empty array when every item is eligible (submit may proceed).
 * An item can appear in more than one group (e.g. checked out AND in a kit);
 * resolving either group removes it from the list, which clears both.
 *
 * @param action - The batch action.
 * @param items - The scan list.
 * @param bookingCtx - Required for the `booking_add` and `booking_fulfil`
 *   actions; ignored otherwise. Without it those actions raise nothing.
 * @returns One group per blocker some row raises, in display order.
 */
export function computeBlockers(
  action: BatchScanAction,
  items: BlockableItem[],
  bookingCtx?: BookingBlockerContext
): BlockerGroup[] {
  return candidatesFor(action, items, bookingCtx)
    .filter((candidate) => candidate.affected.length > 0)
    .map((candidate) => ({
      key: candidate.key,
      qrIds: candidate.affected.map((i) => i.qrId),
      message: candidate.message(candidate.affected.length),
    }));
}

/** All qrIds blocked by any group, deduplicated. */
export function blockedQrIds(groups: BlockerGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.qrIds));
}
