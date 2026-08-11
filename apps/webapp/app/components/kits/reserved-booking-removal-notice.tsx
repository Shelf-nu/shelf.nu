/**
 * Reserved-booking removal notice.
 *
 * Removing an asset from a kit deletes the kit-driven `BookingAsset` row on
 * every booking still in a planning status (see
 * `removeKitSlicesFromPlanningBookings` in `~/modules/kit/service.server`).
 * For a DRAFT that is unremarkable; for a RESERVED booking someone has already
 * committed dates and a custodian, so the removal surfaces name those bookings
 * before the user confirms.
 *
 * Advisory only — nothing here blocks the removal. Both kit-removal surfaces
 * render this one component so the wording, the count-and-overflow rule and
 * the accessible treatment can't drift apart.
 *
 * @see {@link file://./../../routes/_layout+/kits.$kitId.assets.manage-assets.tsx}
 * @see {@link file://./remove-asset-from-kit.tsx}
 */

import { TriangleAlertIcon } from "lucide-react";
import { tw } from "~/utils/tw";

/** Minimal booking shape the notice needs — id for dedupe, name for the copy. */
export type ReservedBookingForNotice = { id: string; name: string };

/** How many booking names are spelled out before the list is elided. */
const MAX_NAMED_BOOKINGS = 3;

type ReservedBookingRemovalNoticeProps = {
  /**
   * Reserved bookings that would lose a slice. May contain duplicates across
   * assets (two removed assets can sit on the same booking) — deduped here so
   * neither call site has to remember to.
   */
  bookings: ReservedBookingForNotice[];
  /** How many assets are being removed; drives the singular/plural copy. */
  assetCount: number;
  /**
   * Set when the containing dialog points its `aria-describedby` here, so the
   * notice is read out as the dialog's description instead of appearing
   * silently.
   */
  id?: string;
  className?: string;
};

/**
 * Warning banner naming the RESERVED bookings a kit-removal would empty.
 *
 * Renders nothing when there is no reserved impact, so call sites can mount it
 * unconditionally.
 *
 * Renders a `<span>` (block-displayed) rather than a `<div>` so it stays valid
 * inside an `AlertDialogDescription`, which Radix renders as a `<p>`.
 *
 * @param props - See {@link ReservedBookingRemovalNoticeProps}
 * @returns The notice, or `null` when `bookings` is empty
 */
export function ReservedBookingRemovalNotice({
  bookings,
  assetCount,
  id,
  className,
}: ReservedBookingRemovalNoticeProps) {
  // Dedupe by booking id: the notice counts BOOKINGS, and the same reserved
  // booking can hold slices of several of the assets being removed.
  const unique = [
    ...new Map(bookings.map((booking) => [booking.id, booking])).values(),
  ];
  if (unique.length === 0) return null;

  const names = unique.map((booking) => booking.name);
  // Same count-and-overflow shape as the `moveAssetKitUnits` block message —
  // name up to three, then elide. It spells the remainder out ("and 2 more")
  // rather than reusing that message's trailing ", …", which would collide
  // with this sentence's full stop and render as "…, Gala, ….".
  const shown = names.slice(0, MAX_NAMED_BOOKINGS).join(", ");
  const hiddenCount = names.length - MAX_NAMED_BOOKINGS;
  const overflow = hiddenCount > 0 ? ` and ${hiddenCount} more` : "";
  const bookingPlural = unique.length === 1 ? "" : "s";
  const isSingleAsset = assetCount <= 1;

  return (
    <span
      id={id}
      className={tw(
        "block rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800",
        className
      )}
    >
      {/* Decorative: the "Reserved booking notice:" label carries the meaning,
          so the warning never depends on colour or icon alone (WCAG 1.4.1). */}
      <TriangleAlertIcon
        aria-hidden="true"
        className="mr-1 inline size-3.5 -translate-y-px"
      />
      <strong>Reserved booking notice:</strong>{" "}
      {isSingleAsset
        ? "Removing this asset from the kit also removes it from"
        : `Removing these ${assetCount} assets from the kit also removes them from`}{" "}
      {unique.length} reserved booking{bookingPlural}: {shown}
      {overflow}. Nothing has been checked out yet, so{" "}
      {unique.length === 1 ? "that booking follows" : "those bookings follow"}{" "}
      the kit's contents.
    </span>
  );
}
