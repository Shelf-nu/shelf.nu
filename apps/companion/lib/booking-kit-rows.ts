/**
 * Kit grouping for the booking detail list.
 *
 * The booking endpoint sends a flat list of assets plus the kits they belong
 * to. This module turns those two into the rows the screen renders — one
 * header per kit followed by its members when expanded — and answers the three
 * questions that grouping raises: what the kit's badge says, which members a
 * header may select, and whether a removal may name the kit instead of its
 * assets.
 *
 * Everything here is pure and free of React Native so the rules can be tested
 * under Node. The screen owns the pixels; this owns the decisions.
 *
 * @see ../app/(tabs)/bookings/[id].tsx — the only consumer
 * @see ../../../apps/webapp/app/modules/booking/shape-booking-assets.ts — the
 *   web grouping this mirrors
 */
import { KIT_STATUS_LABELS } from "@shelf/labels";

import type { BookingAsset, BookingKit } from "./api/types";

/** The booking statuses in which assets are out and can come back. */
const LIVE_BOOKING_STATUSES = ["ONGOING", "OVERDUE"];

/** The booking statuses that are over, whatever happened during them. */
const FINISHED_BOOKING_STATUSES = ["COMPLETE", "ARCHIVED"];

/** A kit's header row, carrying every member the booking holds. */
export type BookingKitRow = {
  type: "kit";
  /** The `Kit.id`, which is also this row's identity in the list. */
  kitId: string;
  name: string;
  /**
   * The kit's own record. Null when the server did not send `booking.kits`,
   * in which case the header falls back to the name and member count that
   * the assets themselves carry.
   */
  kit: BookingKit | null;
  /** The kit's members on THIS booking, in the order the server sent them. */
  members: BookingAsset[];
};

/** One asset row; `inKit` when it sits under a kit header. */
export type BookingAssetRow = {
  type: "asset";
  item: BookingAsset;
  inKit: boolean;
};

/**
 * The band closing an expanded kit. Without it the last member and the next
 * standalone asset are two cards in a row with nothing saying where the group
 * ended.
 */
export type BookingKitEndRow = { type: "kit-end"; kitId: string };

export type BookingRow = BookingKitRow | BookingAssetRow | BookingKitEndRow;

/**
 * Groups a booking's assets under their kits.
 *
 * Walks the assets in server order and emits a kit header the first time a
 * member of that kit is met, holding every member of it; the kit's remaining
 * members are then only emitted as rows while the kit is expanded. An asset
 * with no unanimous kit — standalone, or a quantity-tracked asset whose slices
 * disagree — stays a row of its own where it sits.
 *
 * @param args.assets - the booking's assets, in the order to render them
 * @param args.kits - the kits the server sent, if any
 * @param args.expandedKitIds - which kits are currently open
 * @returns the flat row list to hand to the list
 */
export function buildBookingRows({
  assets,
  kits,
  expandedKitIds,
}: {
  assets: BookingAsset[];
  kits?: BookingKit[];
  expandedKitIds: ReadonlySet<string>;
}): BookingRow[] {
  const rows: BookingRow[] = [];
  const emittedKitIds = new Set<string>();

  for (const asset of assets) {
    // Both halves are required, exactly as web keys on `asset.kitId && asset.kit`:
    // an id with no kit object has nothing to title a header with.
    if (!asset.kitId || !asset.kit) {
      rows.push({ type: "asset", item: asset, inKit: false });
      continue;
    }
    if (emittedKitIds.has(asset.kitId)) continue;
    emittedKitIds.add(asset.kitId);

    const kitId = asset.kitId;
    const members = assets.filter((candidate) => candidate.kitId === kitId);
    rows.push({
      type: "kit",
      kitId,
      name: asset.kit.name,
      kit: kits?.find((kit) => kit.id === kitId) ?? null,
      members,
    });
    if (expandedKitIds.has(kitId)) {
      for (const member of members) {
        rows.push({ type: "asset", item: member, inKit: true });
      }
      rows.push({ type: "kit-end", kitId });
    }
  }

  return rows;
}

/**
 * A row's list key. Kit ids and asset ids are drawn from different tables, so
 * the prefix is what keeps them from colliding.
 *
 * @param row - the row to identify
 * @returns a key unique within one render of the list
 */
export function bookingRowKey(row: BookingRow): string {
  switch (row.type) {
    case "kit":
      return `kit:${row.kitId}`;
    case "kit-end":
      return `kit-end:${row.kitId}`;
    default:
      return `asset:${row.item.id}`;
  }
}

/**
 * Names what a booking holds, counting a kit as one thing.
 *
 * @param args.standaloneAssetCount - assets that belong to no kit here
 * @param args.kitCount - kit groups
 * @returns e.g. `"18 assets and 2 kits"`, `"7 assets"`, `"2 kits"`
 * @see ../../../apps/webapp/app/utils/booking-rows.ts — `describeBookingRows`,
 *   whose wording this reproduces
 */
export function describeBookingRows({
  standaloneAssetCount,
  kitCount,
}: {
  standaloneAssetCount: number;
  kitCount: number;
}): string {
  const parts: string[] = [];
  // A kits-only booking reads "2 kits", not "0 assets and 2 kits".
  if (standaloneAssetCount > 0 || kitCount === 0) {
    parts.push(
      `${standaloneAssetCount} ${
        standaloneAssetCount === 1 ? "asset" : "assets"
      }`
    );
  }
  if (kitCount > 0) {
    parts.push(`${kitCount} ${kitCount === 1 ? "kit" : "kits"}`);
  }
  return parts.join(" and ");
}

/**
 * Which colour vocabulary a kit header's badge speaks, and what it says.
 *
 * `tone` names a state rather than a colour so the screen keeps ownership of
 * the palette: "returned" borrows the member rows' completed colours, the
 * three kit statuses use the shared status colours, and PARTIALLY_CHECKED_IN
 * borrows IN_CUSTODY's.
 */
export type BookingKitBadge = {
  tone: "returned" | "PARTIALLY_CHECKED_IN" | BookingKit["status"];
  label: string;
};

/**
 * Whether a member has been fully checked back in on this booking.
 *
 * A quantity-tracked member is judged by units — booked, and none left to
 * reconcile — because its global status returns to AVAILABLE while units are
 * still out. `remainingToCheckIn` is the counter to read: `remainingToCheckOut`
 * returns to the booked figure once everything is back, which would report a
 * fully-returned member as never having left.
 */
function isMemberBackIn(
  member: BookingAsset,
  checkedInAssetIds: readonly string[]
): boolean {
  if (member.type === "QUANTITY_TRACKED") {
    const booked = member.quantity ?? 0;
    return booked > 0 && (member.remainingToCheckIn ?? booked) === 0;
  }
  return checkedInAssetIds.includes(member.id);
}

/**
 * The badge for a kit header, or null when there is nothing to say.
 *
 * Three cases, in order: every member is back while the booking is still
 * running; the booking is over and the kit went out on it; otherwise the kit's
 * own status. A booking whose check-out left no per-slice markers is one that
 * went out in a single action, so its members all went out.
 *
 * Returns null without a kit record: an older server sends no `booking.kits`,
 * and a status invented from the rows alone would be a guess.
 *
 * @param args.kit - the kit record, when the server sent one
 * @param args.members - the kit's members on this booking
 * @param args.bookingStatus - the booking's status
 * @param args.checkedInAssetIds - assets already checked back in
 * @param args.checkedOutAssetIds - assets this booking sent out, if known
 * @returns the badge to render, or null for no badge
 * @see ../../../apps/webapp/app/components/booking/kit-row.tsx — the web rule
 */
export function resolveBookingKitBadge({
  kit,
  members,
  bookingStatus,
  checkedInAssetIds,
  checkedOutAssetIds,
}: {
  kit: BookingKit | null;
  members: BookingAsset[];
  bookingStatus: string;
  checkedInAssetIds: readonly string[];
  checkedOutAssetIds?: readonly string[];
}): BookingKitBadge | null {
  if (!kit) return null;

  if (
    LIVE_BOOKING_STATUSES.includes(bookingStatus) &&
    members.length > 0 &&
    members.every((member) => isMemberBackIn(member, checkedInAssetIds))
  ) {
    return {
      tone: "PARTIALLY_CHECKED_IN",
      label: KIT_STATUS_LABELS.PARTIALLY_CHECKED_IN,
    };
  }

  if (FINISHED_BOOKING_STATUSES.includes(bookingStatus)) {
    const noMarkers = !checkedOutAssetIds || checkedOutAssetIds.length === 0;
    const everyMemberWentOut =
      noMarkers ||
      members.every((member) => checkedOutAssetIds.includes(member.id));
    if (everyMemberWentOut) return { tone: "returned", label: "Returned" };
  }

  return { tone: kit.status, label: KIT_STATUS_LABELS[kit.status] };
}

/** The selection modes the booking detail list offers. */
export type BookingSelectMode = "checkin" | "checkout" | "remove" | null;

/**
 * Whether a row can be picked in the current mode.
 *
 * Quantity-tracked assets are judged by units, not status: a partly
 * checked-out one stays AVAILABLE while units are still reserved. A returned
 * individual asset is AVAILABLE again too, so check-out excludes the ones
 * already checked in rather than re-offering them.
 *
 * @param item - the asset row
 * @param selectMode - the active mode, or null when not selecting
 * @param checkedInAssetIds - assets already checked back in
 * @returns true when tapping the row toggles its selection
 */
export function isBookingAssetSelectable(
  item: BookingAsset,
  selectMode: BookingSelectMode,
  checkedInAssetIds: readonly string[]
): boolean {
  if (selectMode === "remove") return true;
  if (selectMode === null) return false;

  const isQuantityTracked = item.type === "QUANTITY_TRACKED";
  const isCheckedIn = checkedInAssetIds.includes(item.id);
  const isCheckedOut = item.status === "CHECKED_OUT";

  if (selectMode === "checkin") {
    return isQuantityTracked
      ? (item.remainingToCheckIn ?? 0) > 0
      : isCheckedOut && !isCheckedIn;
  }
  return isQuantityTracked
    ? (item.remainingToCheckOut ?? 0) > 0
    : !isCheckedOut && !isCheckedIn;
}

/** How much of a kit's selectable membership is currently picked. */
export type KitSelectionState = "none" | "some" | "all" | "unselectable";

/**
 * How a kit header's checkbox should read.
 *
 * @param members - the kit's members on this booking
 * @param selectMode - the active mode
 * @param selectedAssetIds - the current selection
 * @param checkedInAssetIds - assets already checked back in
 * @returns "unselectable" when the mode offers none of the members
 */
export function resolveKitSelectionState({
  members,
  selectMode,
  selectedAssetIds,
  checkedInAssetIds,
}: {
  members: BookingAsset[];
  selectMode: BookingSelectMode;
  selectedAssetIds: ReadonlySet<string>;
  checkedInAssetIds: readonly string[];
}): KitSelectionState {
  const selectable = members.filter((member) =>
    isBookingAssetSelectable(member, selectMode, checkedInAssetIds)
  );
  if (selectable.length === 0) return "unselectable";
  const picked = selectable.filter((member) =>
    selectedAssetIds.has(member.id)
  ).length;
  if (picked === 0) return "none";
  return picked === selectable.length ? "all" : "some";
}

/**
 * Splits a removal selection into the kits it can name and the assets it
 * cannot.
 *
 * Naming a kit is only equivalent to naming its members when the booking holds
 * ALL of them: the remove endpoint expands a kit to every asset in it and
 * deletes each one's kit-driven rows, so a kit that is only partly on this
 * booking — or one with a member shown standalone because its slices disagree
 * — would lose rows nobody selected. Everything that fails that test travels
 * as plain asset ids, which is what the screen sent before kits were grouped.
 *
 * @param args.rows - the rendered rows, which carry the kit groupings
 * @param args.selectedAssetIds - the current selection
 * @returns the two id lists to post
 * @see ../../../apps/webapp/app/routes/api+/mobile+/bookings.remove-assets.ts
 */
export function splitRemovalSelection({
  rows,
  selectedAssetIds,
}: {
  rows: BookingRow[];
  selectedAssetIds: ReadonlySet<string>;
}): { assetIds: string[]; kitIds: string[] } {
  const kitIds: string[] = [];
  const coveredByKit = new Set<string>();

  for (const row of rows) {
    if (row.type !== "kit" || !row.kit) continue;
    const wholeKitIsHere = row.members.length === row.kit.assetCount;
    const everyMemberPicked = row.members.every((member) =>
      selectedAssetIds.has(member.id)
    );
    if (!wholeKitIsHere || !everyMemberPicked) continue;
    kitIds.push(row.kitId);
    for (const member of row.members) coveredByKit.add(member.id);
  }

  return {
    assetIds: [...selectedAssetIds].filter((id) => !coveredByKit.has(id)),
    kitIds,
  };
}

/**
 * Names what a removal will take, leading with the kits because a kit is the
 * larger thing leaving the booking.
 *
 * @param args.assetCount - assets removed by id
 * @param args.kitCount - kits removed as a whole
 * @returns e.g. `"1 kit and 2 assets"`, `"3 assets"`
 */
export function describeRemoval({
  assetCount,
  kitCount,
}: {
  assetCount: number;
  kitCount: number;
}): string {
  const parts: string[] = [];
  if (kitCount > 0) {
    parts.push(`${kitCount} ${kitCount === 1 ? "kit" : "kits"}`);
  }
  if (assetCount > 0 || kitCount === 0) {
    parts.push(`${assetCount} ${assetCount === 1 ? "asset" : "assets"}`);
  }
  return parts.join(" and ");
}
