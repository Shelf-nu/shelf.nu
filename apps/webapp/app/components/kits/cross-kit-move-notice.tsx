/**
 * Cross-kit move notice for the kit "Add assets" confirm dialog.
 *
 * An INDIVIDUAL asset belongs to one kit at a time, so ticking one that already
 * sits in another kit and confirming MOVES it: `updateKitAssets` deletes its
 * membership in the other kit and its slices on that kit's DRAFT/RESERVED
 * bookings (`removeKitSlicesFromPlanningBookings`), while ONGOING/OVERDUE
 * bookings keep the slice relabelled. The confirm names these assets so the
 * operator sees the move before it happens.
 *
 * QUANTITY_TRACKED assets are not listed: their units can sit in several kits
 * at once, so adding them here leaves their other kits untouched.
 *
 * Advisory only, nothing here blocks the move.
 *
 * @see {@link file://./../../routes/_layout+/kits.$kitId.assets.manage-assets.tsx}
 * @see {@link file://./booking-removal-notice.tsx}
 */

import { AssetType } from "@prisma/client";
import { ArrowRightLeftIcon } from "lucide-react";
import { formatNameList } from "~/utils/format-name-list";
import { tw } from "~/utils/tw";

/** One asset that confirming would take out of another kit. */
export type CrossKitMove = {
  assetId: string;
  assetTitle: string;
  fromKitId: string;
  fromKitName: string;
};

/**
 * The fields of a picker row this notice reads. Declared so a renamed field
 * fails typecheck: the picker's selection is `ListItemData`, whose index
 * signature types every field as `any`.
 */
export type CrossKitMoveCandidate = {
  id: string;
  title?: string | null;
  type?: AssetType;
  /** Present on rows from the asset list; absent on rows seeded from the kit. */
  assetKits?: { kit?: { id: string; name: string } | null }[] | null;
};

/**
 * Picks the selected INDIVIDUAL assets whose current kit is not this one.
 *
 * Rows carry their kit membership as `assetKits[].kit` (the picker's "Kit"
 * column reads the same field). Rows seeded from the kit's own members carry
 * no `assetKits` and are skipped, as are assets already in this kit.
 *
 * @param selectedItems - The picker's selection after the user's edits
 * @param kitId - The kit being edited
 * @returns One entry per asset that would leave another kit
 */
export function getCrossKitMoves(
  selectedItems: CrossKitMoveCandidate[],
  kitId: string
): CrossKitMove[] {
  return selectedItems.flatMap((item) => {
    if (item.type !== AssetType.INDIVIDUAL) return [];
    const otherKit = item.assetKits?.find(
      (assetKit) => assetKit.kit && assetKit.kit.id !== kitId
    )?.kit;
    if (!otherKit) return [];
    return [
      {
        assetId: item.id,
        assetTitle: item.title || "Untitled asset",
        fromKitId: otherKit.id,
        fromKitName: otherKit.name,
      },
    ];
  });
}

/**
 * Renders the moves as "Camera A (from Box 1), Mic (from Box 2) and 2 more".
 *
 * @param moves - The moves to name
 * @returns The rendered list
 */
function formatMoves(moves: CrossKitMove[]): string {
  return formatNameList(
    moves.map((move) => `${move.assetTitle} (from ${move.fromKitName})`)
  );
}

type CrossKitMoveNoticeProps = {
  moves: CrossKitMove[];
  /**
   * Set when the containing dialog points its `aria-describedby` here, so the
   * notice is read out as the dialog's description.
   */
  id?: string;
  className?: string;
};

/**
 * Warning banner naming the assets that would leave their current kit.
 *
 * Renders `<span>`s (block-displayed) for the same reason as
 * `BookingRemovalNotice`: it stays valid inside a `<p>` description.
 *
 * @param props - See {@link CrossKitMoveNoticeProps}
 * @returns The notice, or `null` when nothing moves
 */
export function CrossKitMoveNotice({
  moves,
  id,
  className,
}: CrossKitMoveNoticeProps) {
  if (moves.length === 0) return null;
  const isSingle = moves.length === 1;
  // Several assets can leave the same kit; the copy names one kit or several.
  // Counted by id: two kits can share a name.
  const isSingleKit = new Set(moves.map((move) => move.fromKitId)).size === 1;

  return (
    <span
      id={id}
      className={tw(
        "block rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800",
        className
      )}
    >
      {/* Decorative: the "Kit move notice:" label carries the meaning. */}
      <ArrowRightLeftIcon
        aria-hidden="true"
        className="mr-1 inline size-3.5 -translate-y-px"
      />
      <strong>Kit move notice:</strong> An asset can only be in one kit.{" "}
      {isSingle ? "This asset leaves" : `These ${moves.length} assets leave`}{" "}
      {isSingle ? "its" : "their"} current kit{isSingleKit ? "" : "s"}:{" "}
      {formatMoves(moves)}. {isSingle ? "It also comes" : "They also come"} off
      any draft or reserved bookings{" "}
      {isSingleKit ? "that kit is" : "those kits are"} on.
    </span>
  );
}
