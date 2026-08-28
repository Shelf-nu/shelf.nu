/**
 * Booking-impact notice for kit removals.
 *
 * Removing an asset from a kit does two different things to the bookings that
 * hold it through that kit (see `getBookingImpactForAssetKits` in
 * `~/modules/kit/service.server`):
 *
 * - `RESERVED` — the kit-driven `BookingAsset` row is DELETED. Nothing is out
 *   yet, so the booking follows the kit's contents.
 * - `ONGOING` / `OVERDUE` — the row is KEPT and flagged as removed from the
 *   kit, because those units are physically out and the booking has to keep
 *   recording what went out.
 *
 * The two outcomes get their own group so the copy can be truthful about each;
 * both render when both apply. Historical statuses (`COMPLETE` / `ARCHIVED` /
 * `CANCELLED`) are deliberately absent — the operator can do nothing about
 * them and a popular kit would drown the actionable groups in them.
 *
 * Advisory only — nothing here blocks the removal. Both kit-removal surfaces
 * render this one component so the wording, the count-and-overflow rule and
 * the accessible treatment can't drift apart.
 *
 * @see {@link file://./../../routes/_layout+/kits.$kitId.assets.manage-assets.tsx}
 * @see {@link file://./remove-asset-from-kit.tsx}
 */

import { PackageCheckIcon, TriangleAlertIcon } from "lucide-react";
import { tw } from "~/utils/tw";

/** Minimal booking shape the notice needs — id for dedupe, name for the copy. */
export type BookingForNotice = { id: string; name: string };

/**
 * One outcome group's input.
 *
 * @property bookings - Bookings in this group. May contain duplicates across
 *   assets (two removed assets can sit on the same booking) — deduped here so
 *   neither call site has to remember to.
 * @property assetCount - How many of the assets being removed sit on these
 *   bookings; drives the singular/plural copy. Counted per group because the
 *   two groups rarely cover the same assets.
 */
export type BookingRemovalNoticeGroup = {
  bookings: BookingForNotice[];
  assetCount: number;
};

/**
 * A single asset's removal impact, as the row-level surfaces carry it.
 *
 * Structurally identical to `AssetKitBookingImpact` in
 * `~/modules/kit/service.server` — restated here so client components never
 * import from a `*.server` module (see
 * `.claude/rules/no-server-module-in-route-client-exports.md`).
 */
export type KitRemovalBookingImpact = {
  /** RESERVED bookings that lose the asset when it leaves the kit. */
  reserved: BookingForNotice[];
  /** ONGOING/OVERDUE bookings that keep it, flagged as removed from the kit. */
  checkedOut: BookingForNotice[];
};

/** How many booking names are spelled out before the list is elided. */
const MAX_NAMED_BOOKINGS = 3;

type BookingRemovalNoticeProps = {
  /** RESERVED bookings that would LOSE their slice. */
  reserved?: BookingRemovalNoticeGroup;
  /** ONGOING/OVERDUE bookings that KEEP the slice, relabelled. */
  checkedOut?: BookingRemovalNoticeGroup;
  /**
   * Set when the containing dialog points its `aria-describedby` here, so the
   * notice is read out as the dialog's description instead of appearing
   * silently.
   */
  id?: string;
  className?: string;
};

/**
 * Dedupes by booking id — the notice counts BOOKINGS, and the same booking can
 * hold slices of several of the assets being removed.
 */
function dedupe(bookings: BookingForNotice[]): BookingForNotice[] {
  return [
    ...new Map(bookings.map((booking) => [booking.id, booking])).values(),
  ];
}

/**
 * Renders the booking list as "A, B, C and 2 more".
 *
 * Same count-and-overflow shape as the `moveAssetKitUnits` block message —
 * name up to three, then elide. It spells the remainder out ("and 2 more")
 * rather than reusing that message's trailing ", …", which would collide with
 * this sentence's full stop and render as "…, Gala, ….".
 *
 * @param bookings - Already-deduped bookings
 * @returns The rendered name list
 */
function formatBookingNames(bookings: BookingForNotice[]): string {
  const names = bookings.map((booking) => booking.name);
  const shown = names.slice(0, MAX_NAMED_BOOKINGS).join(", ");
  const hiddenCount = names.length - MAX_NAMED_BOOKINGS;
  return hiddenCount > 0 ? `${shown} and ${hiddenCount} more` : shown;
}

/**
 * Warning banner naming the RESERVED bookings a kit-removal would empty.
 *
 * @param props.bookings - Deduped reserved bookings (never empty)
 * @param props.assetCount - Assets being removed that sit on those bookings
 * @returns The reserved-group block
 */
function ReservedGroup({ bookings, assetCount }: BookingRemovalNoticeGroup) {
  const bookingPlural = bookings.length === 1 ? "" : "s";

  return (
    <span className="block rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800">
      {/* Decorative: the "Reserved booking notice:" label carries the meaning,
          so the warning never depends on colour or icon alone (WCAG 1.4.1). */}
      <TriangleAlertIcon
        aria-hidden="true"
        className="mr-1 inline size-3.5 -translate-y-px"
      />
      <strong>Reserved booking notice:</strong>{" "}
      {assetCount <= 1
        ? "Removing this asset from the kit also removes it from"
        : `Removing these ${assetCount} assets from the kit also removes them from`}{" "}
      {bookings.length} reserved booking{bookingPlural}:{" "}
      {formatBookingNames(bookings)}. Nothing has been checked out yet, so{" "}
      {bookings.length === 1 ? "that booking follows" : "those bookings follow"}{" "}
      the kit's contents.
    </span>
  );
}

/**
 * Info banner naming the ONGOING/OVERDUE bookings that keep the asset.
 *
 * Styled informational rather than warning: unlike the reserved group nothing
 * is lost here, the asset is only relabelled. The leading label still carries
 * the meaning in text, so the distinction never rests on colour (WCAG 1.4.1).
 *
 * @param props.bookings - Deduped ongoing/overdue bookings (never empty)
 * @param props.assetCount - Assets being removed that sit on those bookings
 * @returns The checked-out-group block
 */
function CheckedOutGroup({ bookings, assetCount }: BookingRemovalNoticeGroup) {
  const bookingPlural = bookings.length === 1 ? "" : "s";
  const isSingleAsset = assetCount <= 1;

  return (
    <span className="block rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
      <PackageCheckIcon
        aria-hidden="true"
        className="mr-1 inline size-3.5 -translate-y-px"
      />
      <strong>In-progress booking notice:</strong>{" "}
      {isSingleAsset ? "This asset is on" : `These ${assetCount} assets are on`}{" "}
      {bookings.length} booking{bookingPlural} already in progress:{" "}
      {formatBookingNames(bookings)}. {isSingleAsset ? "It stays" : "They stay"}{" "}
      on {bookings.length === 1 ? "that booking" : "those bookings"}, marked as
      removed from the kit, so the record of what was booked is preserved.
    </span>
  );
}

/**
 * Names the bookings a kit-removal would affect, one block per outcome.
 *
 * Renders nothing when there is no impact at all, so call sites can mount it
 * unconditionally.
 *
 * Renders `<span>`s (block-displayed) rather than `<div>`s so it stays valid
 * inside an `AlertDialogDescription`, which Radix renders as a `<p>`.
 *
 * @param props - See {@link BookingRemovalNoticeProps}
 * @returns The notice, or `null` when neither group has bookings
 */
export function BookingRemovalNotice({
  reserved,
  checkedOut,
  id,
  className,
}: BookingRemovalNoticeProps) {
  const reservedBookings = dedupe(reserved?.bookings ?? []);
  const checkedOutBookings = dedupe(checkedOut?.bookings ?? []);
  if (reservedBookings.length === 0 && checkedOutBookings.length === 0) {
    return null;
  }

  return (
    <span id={id} className={tw("block space-y-2", className)}>
      {reservedBookings.length > 0 ? (
        <ReservedGroup
          bookings={reservedBookings}
          assetCount={reserved?.assetCount ?? 1}
        />
      ) : null}
      {checkedOutBookings.length > 0 ? (
        <CheckedOutGroup
          bookings={checkedOutBookings}
          assetCount={checkedOut?.assetCount ?? 1}
        />
      ) : null}
    </span>
  );
}
