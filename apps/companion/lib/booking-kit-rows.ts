/**
 * Kit grouping for the booking detail list.
 *
 * The booking endpoint sends a flat list of assets plus the kits they belong
 * to. This module turns those two into the rows the screen renders — one
 * header per kit followed by its members when expanded — and answers the
 * questions that grouping raises: what the kit's badge says, which members a
 * header may select, how a selection reads on the action button and in the
 * check-out and check-in alerts, and whether a removal may name the kit
 * instead of its assets.
 *
 * Everything here is pure and free of React Native so the rules can be tested
 * under Node. The screens own the pixels; this owns the decisions.
 *
 * `describeBookingRows` is a MIRROR of the webapp helper of the same name and
 * is never a source of truth; its own JSDoc carries the provenance and the
 * extraction target. The grouping, badge and removal rules are not copies —
 * they are written against the mobile payload, which collapses a booking per
 * asset rather than per row — but each must reach the same outcome as the web
 * surface its `@see` names.
 *
 * @see ../app/(tabs)/bookings/[id].tsx — the booking detail list
 * @see ../app/(tabs)/scanner.tsx — counts a scanned check-out or check-in batch
 *   with the same rules, through `countBookingBatch`
 * @see ../../../apps/webapp/app/modules/booking/shape-booking-assets.ts — the
 *   web grouping this mirrors
 */
import {
  ASSET_STATUS_LABELS,
  BOOKING_STATUS_LABELS,
  KIT_STATUS_LABELS,
} from "@shelf/labels";

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

  // Members are grouped once up front rather than re-scanned per kit: this
  // runs on every expand and collapse, and a booking can hold hundreds of
  // assets. Keyed on `kitId` alone — an id with no kit object still belongs to
  // that group even though it renders as a row of its own below.
  const membersByKitId = new Map<string, BookingAsset[]>();
  for (const asset of assets) {
    if (!asset.kitId) continue;
    const group = membersByKitId.get(asset.kitId);
    if (group) group.push(asset);
    else membersByKitId.set(asset.kitId, [asset]);
  }

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
    const members = membersByKitId.get(kitId) ?? [];
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
 * MIRROR of `apps/webapp/app/utils/booking-rows.ts`, which is the source of
 * truth for this wording; the copy exists only because the companion cannot
 * import from `apps/webapp/app/**`. It is cosmetic — it captions a list the
 * user is already looking at and gates nothing — so a drift between the two
 * shows up as different words, never as different data.
 *
 * What is mirrored is the EFFECTIVE wording, not the code: the web helper
 * derives its two counts from a rendered row array, while this one is handed
 * them. The strings must stay identical, including the kits-only form that
 * drops the asset half. Change one, change both.
 *
 * Extraction target: `@shelf/labels`, which both apps already consume for
 * user-facing strings; moving it there retires this mirror.
 *
 * @param args.standaloneAssetCount - assets that belong to no kit here
 * @param args.kitCount - kit groups
 * @returns e.g. `"18 assets and 2 kits"`, `"7 assets"`, `"2 kits"`
 * @see ../../../apps/webapp/app/utils/booking-rows.ts — the canonical helper
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
 * Units of a quantity-tracked asset that are out on this booking and not yet
 * back: what it sent out, less what has been returned, consumed, lost or
 * damaged.
 *
 * THE check-in test, and `remainingToCheckIn` is not. That counter is booked
 * minus dispositioned, so it counts units that never left: on a row nothing
 * was ever checked out for it equals the whole booked quantity, while
 * `partialCheckinBooking` refuses any row no slice of which carries a
 * departure marker. Offer check-in on it and the server declines the submit.
 *
 * Bounded by `remainingToCheckIn`, because that is the cap the endpoint
 * applies to every claim it accepts. The two agree on every single-trip
 * booking. They part on a row that went out, came back and went out again
 * inside one booking: the departure count keeps climbing while the cap —
 * booked minus everything dispositioned — has already reached zero. Those
 * units are physically out and still cannot be checked in, so they must not be
 * offered.
 *
 * Falls back to `remainingToCheckIn` against a server that sends no unit
 * totals. That server cannot tell dispatched units from booked ones, so there
 * is nothing better to answer with, bug included.
 *
 * INDIVIDUAL rows are not measured in units and are judged by status; they
 * carry no counters at all, so this returns 0 for them.
 *
 * @param item - the asset row from the booking detail response
 * @returns units still out and acceptable to the endpoint, never negative
 * @see ../../../apps/webapp/app/modules/booking/service.server.ts — `partialCheckinBooking`,
 *   the guard this keeps the screen on the right side of
 */
export function unitsStillOut(item: BookingAsset): number {
  const { dispatchedUnitsTotal, dispositionedUnitsTotal, remainingToCheckIn } =
    item;
  // The route attaches all four counters to a quantity row or none of them,
  // so one total missing means the whole set is.
  if (
    dispatchedUnitsTotal === undefined ||
    dispositionedUnitsTotal === undefined
  ) {
    return remainingToCheckIn ?? 0;
  }
  const stillOut = Math.max(0, dispatchedUnitsTotal - dispositionedUnitsTotal);
  return Math.min(stillOut, remainingToCheckIn ?? 0);
}

/**
 * Booking-scoped lifecycle state for a QUANTITY_TRACKED asset row. The asset's
 * GLOBAL status ("Available") is meaningless on a booking — what matters is how
 * many of the booked units are reserved / checked out / returned. `key` indexes
 * the shared `bookingStatusBadge` colours so the row reuses the booking colour
 * vocabulary (blue reserved, orange in-progress, green complete).
 *
 * Reads the unit totals when the server sends them, because they are what the
 * kit header above this row is judged by (`isMemberBackIn`). Deriving "done"
 * from `remainingToCheckIn` instead makes the two disagree on a row that went
 * out, came back and went out again: the endpoint's cap reaches zero while the
 * second trip is still in the field, so the row would read "Returned" under a
 * header that still reads Available.
 *
 * @param args - booked units, the remaining counts, the booking-lifetime unit
 *   totals when present, and the parent booking's status (to tell a DRAFT line
 *   apart from a reserved one).
 * @returns The badge `{ key, label }` for this asset on this booking.
 */
export function getBookingAssetState({
  booked,
  remOut,
  remIn,
  dispatched,
  dispositioned,
  bookingStatus,
}: {
  booked: number;
  remOut?: number;
  remIn?: number;
  dispatched?: number;
  dispositioned?: number;
  bookingStatus: string;
}): { key: string; label: string } {
  const reserved =
    bookingStatus === "DRAFT"
      ? { key: "DRAFT", label: BOOKING_STATUS_LABELS.DRAFT }
      : { key: "RESERVED", label: BOOKING_STATUS_LABELS.RESERVED };

  if (booked <= 0) return reserved;

  // why: the labels that name a real status read from @shelf/labels. The
  // fraction forms and "Returned" stay bespoke — they are booking-scoped
  // progress, not statuses, so the package has no entry for them.
  if (dispatched !== undefined && dispositioned !== undefined) {
    // Done when every unit this booking sent out is accounted for — the same
    // threshold the kit header applies, so the two always agree.
    if (dispositioned >= Math.max(booked, dispatched))
      return { key: "COMPLETE", label: "Returned" };
    if (dispatched <= 0) return reserved;

    const stillOut = Math.max(0, dispatched - dispositioned);
    if (stillOut >= booked)
      return { key: "ONGOING", label: ASSET_STATUS_LABELS.CHECKED_OUT };
    if (stillOut > 0)
      return { key: "ONGOING", label: `${stillOut}/${booked} out` };
    return {
      key: "ONGOING",
      label: `${Math.min(dispositioned, booked)}/${booked} returned`,
    };
  }

  // An older server sends no totals; judge by the remaining counts alone.
  const clampedOut = Math.min(Math.max(remOut ?? booked, 0), booked);
  const clampedIn = Math.min(Math.max(remIn ?? booked, 0), booked);
  const checkedOut = booked - clampedOut; // units taken from the workspace
  const checkedIn = booked - clampedIn; // units reconciled back in

  if (checkedOut <= 0) return reserved;
  if (checkedIn >= booked) return { key: "COMPLETE", label: "Returned" };
  if (checkedIn > 0)
    return { key: "ONGOING", label: `${checkedIn}/${booked} returned` };
  if (checkedOut >= booked)
    return { key: "ONGOING", label: ASSET_STATUS_LABELS.CHECKED_OUT };
  return { key: "ONGOING", label: `${checkedOut}/${booked} out` };
}

/**
 * Whether a member has been fully checked back in on this booking.
 *
 * A quantity-tracked member is judged by units — booked, and every one of them
 * accounted for — because its global status returns to AVAILABLE while units
 * are still out. `dispositioned >= booked` is the web's own rule for the same
 * question (`getBookingContextKitStatus`), so a kit reads the same on both
 * surfaces.
 *
 * The threshold is the LARGER of the booked quantity and what the booking has
 * actually sent out, so a member on a second trip is not called done while
 * that trip is in the field. The two are the same number on every single-trip
 * booking, so this only extends the web's rule to a case the web cannot reach.
 *
 * Deliberately a threshold against the booked quantity rather than
 * `unitsStillOut`: the badge answers whether this booking is FINISHED with the
 * member, not whether anything is out right now. A member booked 4 with 2 sent
 * out and 2 returned still reads Available on both surfaces — the other 2
 * never left.
 *
 * Falls back to `remainingToCheckIn === 0` against a server that sends no unit
 * totals, which is the same statement in the arithmetic that server offers.
 *
 * @see ../../../apps/webapp/app/utils/booking-assets.ts — `getBookingContextKitStatus`
 */
function isMemberBackIn(
  member: BookingAsset,
  checkedInAssetIds: readonly string[]
): boolean {
  if (member.type === "QUANTITY_TRACKED") {
    const booked = member.quantity ?? 0;
    if (booked <= 0) return false;
    return member.dispositionedUnitsTotal === undefined
      ? (member.remainingToCheckIn ?? booked) === 0
      : member.dispositionedUnitsTotal >=
          Math.max(booked, member.dispatchedUnitsTotal ?? 0);
  }
  return checkedInAssetIds.includes(member.id);
}

/**
 * The badge for a kit header, or null when there is nothing to say.
 *
 * Three cases, in order: every member is back while the booking is still
 * running; the booking is over and the kit went out on it; otherwise the kit's
 * own status.
 *
 * Whether a kit went out is read from THIS kit's own members. Check-out
 * markers are recorded per slice and the all-at-once Check out button records
 * none, so their absence is not evidence a kit stayed behind: a kit no member
 * of which carries a marker is read as having gone out, and only a kit that
 * carries some is judged on whether every member has one. Do not reduce this
 * to a booking-wide "are there any markers at all?" — one asset scanned out
 * anywhere would then strip the badge off every kit that left with the button.
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
    // An absent field (older server) and an empty one are the same statement:
    // this kit has no markers, so it is read the legacy way.
    // Set, not `Array.includes`: this runs once per kit row on every render,
    // and the marker list is booking-wide, so a linear scan per member costs
    // members x markers on a booking large enough for grouping to matter.
    const markers = new Set(checkedOutAssetIds ?? []);
    const markedMemberCount = members.filter((member) =>
      markers.has(member.id)
    ).length;
    const everyMemberWentOut =
      markedMemberCount === 0 || markedMemberCount === members.length;
    if (everyMemberWentOut) return { tone: "returned", label: "Returned" };
  }

  return { tone: kit.status, label: KIT_STATUS_LABELS[kit.status] };
}

/** The selection modes the booking detail list offers. */
export type BookingSelectMode = "checkin" | "checkout" | "remove" | null;

/**
 * Whether the current mode can act on an asset.
 *
 * This answers for the asset, not for where it is drawn. A standalone row is
 * picked by its own tap when this holds; a kit member is never picked from its
 * own row, and its header uses this to decide which members one tick picks.
 *
 * Quantity-tracked assets are judged by units, not status: a partly
 * checked-out one stays AVAILABLE while units are still reserved. A returned
 * individual asset is AVAILABLE again too, so check-out excludes the ones
 * already checked in rather than re-offering them.
 *
 * The two directions read different counters, and swapping them is the bug
 * this comment exists to prevent. Check-out asks what is still reserved and has
 * not gone out ({@link BookingAsset.remainingToCheckOut}); check-in asks what
 * went out and is not back ({@link unitsStillOut}). Booked-but-never-dispatched
 * units belong to the first question and not the second.
 *
 * @param item - the asset
 * @param selectMode - the active mode, or null when not selecting
 * @param checkedInAssetIds - assets already checked back in
 * @returns true when the mode can act on the asset
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
      ? unitsStillOut(item) > 0
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

/** What a selection holds, with a wholly picked kit counted as one thing. */
export type SelectionCounts = { kitCount: number; assetCount: number };

/**
 * Counts a selection the way the list offers it: a kit is one thing, and every
 * other pick is an asset.
 *
 * `kitCount` is the kits picked whole: at least one member is picked, and no
 * member the mode can act on is left out — what a header reading "all" shows.
 * A picked member counts toward its kit whatever its status now says, so the
 * count of a batch holds while a screen marks that batch as moved.
 * `assetCount` is every selected id those kits do not account for. A member is
 * only ever picked through its header, so these are normally the standalone
 * rows; an id outside every wholly picked kit still counts, so the label covers
 * everything the submit will send.
 *
 * @param args.rows - the rendered rows; a kit header carries every member
 *   whether or not the kit is open
 * @param args.selectedAssetIds - the current selection
 * @param args.selectMode - the active mode
 * @param args.checkedInAssetIds - assets already checked back in
 * @returns the counts `describeSelection` names
 */
export function countSelection({
  rows,
  selectedAssetIds,
  selectMode,
  checkedInAssetIds,
}: {
  rows: BookingRow[];
  selectedAssetIds: ReadonlySet<string>;
  selectMode: BookingSelectMode;
  checkedInAssetIds: readonly string[];
}): SelectionCounts {
  let kitCount = 0;
  const coveredByKit = new Set<string>();

  for (const row of rows) {
    if (row.type !== "kit") continue;
    const somePicked = row.members.some((member) =>
      selectedAssetIds.has(member.id)
    );
    const noneLeftOut = row.members.every(
      (member) =>
        selectedAssetIds.has(member.id) ||
        !isBookingAssetSelectable(member, selectMode, checkedInAssetIds)
    );
    if (!somePicked || !noneLeftOut) continue;
    kitCount += 1;
    for (const member of row.members) coveredByKit.add(member.id);
  }

  let assetCount = 0;
  for (const id of selectedAssetIds) {
    if (!coveredByKit.has(id)) assetCount += 1;
  }

  return { kitCount, assetCount };
}

/**
 * Counts a flat batch of asset ids against a booking's own assets, by the same
 * rules as `countSelection`: a kit is one thing once no member of it the mode
 * can act on is left out of the batch.
 *
 * For a caller that holds ids rather than rendered rows. The scanner adds a
 * scanned kit as its member assets, so this is what lets its batch read the
 * way the booking screen reads the same kit.
 *
 * @param args.assets - the booking's assets, which carry the kit groupings
 * @param args.assetIds - the asset ids in the batch
 * @param args.selectMode - "checkout" or "checkin"
 * @param args.checkedInAssetIds - assets already checked back in
 * @returns the counts `describeBatch` and the alert helpers below it name
 */
export function countBookingBatch({
  assets,
  assetIds,
  selectMode,
  checkedInAssetIds,
}: {
  assets: BookingAsset[];
  assetIds: readonly string[];
  selectMode: BookingSelectMode;
  checkedInAssetIds: readonly string[];
}): SelectionCounts {
  return countSelection({
    // Collapsed or open makes no difference: a kit row carries every member.
    rows: buildBookingRows({ assets, expandedKitIds: new Set() }),
    selectedAssetIds: new Set(assetIds),
    selectMode,
    checkedInAssetIds,
  });
}

/**
 * Splits a removal selection into the kits it can name, the assets it cannot,
 * and which of those assets the user ticked as rows of their own.
 *
 * Naming a kit is only equivalent to naming its members when the booking holds
 * ALL of them: the remove endpoint expands a kit to every asset in it and
 * deletes each one's kit-driven rows, so a kit that is only partly on this
 * booking — or one with a member shown standalone because its slices disagree
 * — would lose rows nobody selected.
 *
 * Naming ANY kit also changes how the endpoint reads the plain asset ids
 * beside it: they then delete only a row with no kit of its own
 * (`assetKitId IS NULL`). An asset picked from a kit that is NOT being named
 * has no such row, so it would be reported as removed and quietly stay on the
 * booking. When the selection contains one of those, no kit is named and the
 * whole selection travels as plain ids, which removes every slice of each.
 *
 * `standaloneAssetIds` states that provenance outright instead of leaving the
 * server to infer it from kit membership. It holds the selected ids the list
 * rendered as rows of their own, which is what "the user ticked this asset's
 * own row" means — a quantity-tracked asset whose slices disagree renders that
 * way while still holding kit-driven rows, so membership alone cannot tell the
 * two apart. It is always a subset of `assetIds`, and it is empty on the
 * plain-ids path above, where the split has deliberately given the distinction
 * up and every slice of every selected asset is meant to go.
 *
 * @param args.rows - the rendered rows, which carry the kit groupings
 * @param args.selectedAssetIds - the current selection
 * @returns the id lists to post
 * @see ../../../apps/webapp/app/routes/api+/mobile+/bookings.remove-assets.ts
 * @see ../../../apps/webapp/app/modules/booking/service.server.ts — `removeAssets`,
 *   whose delete clause is what the fallback above exists for
 */
export function splitRemovalSelection({
  rows,
  selectedAssetIds,
}: {
  rows: BookingRow[];
  selectedAssetIds: ReadonlySet<string>;
}): { assetIds: string[]; kitIds: string[]; standaloneAssetIds: string[] } {
  const kitIds: string[] = [];
  const coveredByKit = new Set<string>();
  /** Every asset the booking holds through a kit, named or not. */
  const kitDrivenAssetIds = new Set<string>();
  /** Every asset the list gave a row of its own, rather than a kit member. */
  const standaloneRowAssetIds = new Set<string>();

  for (const row of rows) {
    if (row.type === "asset") {
      if (!row.inKit) standaloneRowAssetIds.add(row.item.id);
      continue;
    }
    if (row.type !== "kit") continue;
    for (const member of row.members) kitDrivenAssetIds.add(member.id);
    if (!row.kit) continue;
    const wholeKitIsHere = row.members.length === row.kit.assetCount;
    const everyMemberPicked = row.members.every((member) =>
      selectedAssetIds.has(member.id)
    );
    if (!wholeKitIsHere || !everyMemberPicked) continue;
    kitIds.push(row.kitId);
    for (const member of row.members) coveredByKit.add(member.id);
  }

  const leftover = [...selectedAssetIds].filter((id) => !coveredByKit.has(id));
  const leftoverHoldsAKitRow = leftover.some((id) => kitDrivenAssetIds.has(id));
  if (leftoverHoldsAKitRow) {
    return {
      assetIds: [...selectedAssetIds],
      kitIds: [],
      standaloneAssetIds: [],
    };
  }

  return {
    assetIds: leftover,
    kitIds,
    standaloneAssetIds: leftover.filter((id) => standaloneRowAssetIds.has(id)),
  };
}

/** The words one kits-then-assets phrase is written in. */
type KitsThenAssetsWording = {
  kit: { one: string; many: string };
  asset: { one: string; many: string };
  joiner: string;
};

/**
 * Names kits and assets, kits first because a kit is the larger thing.
 *
 * A kits-only count drops the asset half ("2 kits", not "2 kits and 0
 * assets"); a count of nothing still names assets, so the phrase is never
 * empty.
 *
 * @param counts - how many kits and assets to name
 * @param wording - the nouns and the word that joins the two halves
 * @returns e.g. `"1 kit and 2 assets"` or `"1 Kit & 2 Assets"`
 */
function describeKitsThenAssets(
  { kitCount, assetCount }: SelectionCounts,
  wording: KitsThenAssetsWording
): string {
  const parts: string[] = [];
  if (kitCount > 0) {
    parts.push(
      `${kitCount} ${kitCount === 1 ? wording.kit.one : wording.kit.many}`
    );
  }
  if (assetCount > 0 || kitCount === 0) {
    parts.push(
      `${assetCount} ${
        assetCount === 1 ? wording.asset.one : wording.asset.many
      }`
    );
  }
  return parts.join(wording.joiner);
}

/**
 * Names a batch inside a sentence, leading with the kits because a kit is the
 * larger thing: what a removal takes off the booking, or what a check-out or
 * check-in moves. Reads mid-sentence, so it is lower case.
 *
 * @param args.kitCount - kits taken as a whole
 * @param args.assetCount - every asset outside those kits
 * @returns e.g. `"1 kit and 2 assets"`, `"3 assets"`, `"2 kits"`
 */
export function describeBatch({
  kitCount,
  assetCount,
}: SelectionCounts): string {
  return describeKitsThenAssets(
    { kitCount, assetCount },
    {
      kit: { one: "kit", many: "kits" },
      asset: { one: "asset", many: "assets" },
      joiner: " and ",
    }
  );
}

/**
 * Names a selection on the floating action button, after its verb:
 * "Check Out 1 Kit & 1 Asset". The verb is Title Case, so the counts are too,
 * and the ampersand keeps a two-part label short.
 *
 * The screen reader label uses the same words, so the button sounds the way it
 * reads.
 *
 * @param args.kitCount - kits picked whole, from `countSelection`
 * @param args.assetCount - picks outside a whole kit, from `countSelection`
 * @returns e.g. `"1 Kit & 1 Asset"`, `"2 Kits"`, `"3 Assets"`
 */
export function describeSelection({
  kitCount,
  assetCount,
}: SelectionCounts): string {
  return describeKitsThenAssets(
    { kitCount, assetCount },
    {
      kit: { one: "Kit", many: "Kits" },
      asset: { one: "Asset", many: "Assets" },
      joiner: " & ",
    }
  );
}

/** Which way a booking batch moves: out, or back in. */
type BookingBatchDirection = "checkout" | "checkin";

/**
 * The question asked before a check-out or check-in batch is sent.
 *
 * It names the batch in the words of the action button that opened it, a
 * wholly picked kit being one thing. Count the batch from the selection before
 * the submit: the request carries member asset ids, so nothing the server
 * sends back can tell a kit from the assets in it.
 *
 * @param args.direction - which way the batch moves
 * @param args.counts - the batch, from `countSelection` or `countBookingBatch`
 * @param args.bookingName - names the booking, for a screen that does not
 *   show it; a blank name is left out
 * @returns e.g. `"Check out 1 kit and 1 asset?"`,
 *   `"Check in 3 assets for "Film shoot"?"`
 */
export function describeBatchConfirm({
  direction,
  counts,
  bookingName,
}: {
  direction: BookingBatchDirection;
  counts: SelectionCounts;
  bookingName?: string | null;
}): string {
  const verb = direction === "checkout" ? "Check out" : "Check in";
  const forBooking = bookingName?.trim() ? ` for "${bookingName}"` : "";
  return `${verb} ${describeBatch(counts)}${forBooking}?`;
}

/**
 * What the success alert says once the server accepts a check-out or check-in
 * batch.
 *
 * A batch that leaves nothing to move speaks for the whole booking. Any other
 * batch names what it moved, in the words its confirm used, and says where the
 * rest of the booking stands without a number: the server counts what remains
 * in assets, one per kit member, which would contradict a batch counted in
 * kits.
 *
 * `isComplete` is the server's answer to "is anything left?". Without one the
 * message names the batch alone rather than guess.
 *
 * The server's check-out skips an asset that is already out, so it can move
 * fewer assets than the batch sent — another check-out took them in the
 * meantime. When `assets` shows that, the batch as counted did not all move,
 * so the message names what moved in the server's own units instead. The
 * server's check-in refuses such an asset rather than skipping it, so only a
 * check-out caller has a reason to pass `assets`.
 *
 * @param args.direction - which way the batch moved
 * @param args.counts - the batch, counted before the submit
 * @param args.isComplete - true when nothing is left to move, per the server
 * @param args.bookingName - the booking's name, for the completed forms
 * @param args.assets - how many distinct assets the request sent, and how many
 *   the server says it moved
 * @returns e.g. `"1 kit and 1 asset checked out. The rest is still reserved."`
 */
export function describeBatchResult({
  direction,
  counts,
  isComplete,
  bookingName,
  assets,
}: {
  direction: BookingBatchDirection;
  counts: SelectionCounts;
  isComplete: boolean | undefined;
  bookingName?: string | null;
  assets?: { sent: number; moved: number };
}): string {
  const quotedName = bookingName?.trim() ? `"${bookingName}"` : null;
  if (isComplete) {
    return direction === "checkout"
      ? `All assets are now checked out for ${quotedName ?? "this booking"}.`
      : `All assets checked in. ${
          quotedName ?? "The booking"
        } is now complete.`;
  }

  const moved = direction === "checkout" ? "checked out" : "checked in";
  const skipped = assets ? assets.sent - assets.moved : 0;
  const summary =
    assets && skipped > 0
      ? `${describeBatch({
          kitCount: 0,
          assetCount: assets.moved,
        })} ${moved}. ${skipped} ${
          skipped === 1 ? "was" : "were"
        } already ${moved}.`
      : `${describeBatch(counts)} ${moved}.`;
  if (isComplete === undefined) return summary;

  const rest =
    direction === "checkout"
      ? "The rest is still reserved."
      : "The rest is still checked out.";
  return `${summary} ${rest}`;
}
