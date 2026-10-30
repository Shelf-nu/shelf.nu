/**
 * The badge on a running booking's item row naming when the item is needed
 * next, and by which booking.
 *
 * Rendered only while the booking is ONGOING or OVERDUE: that is when the
 * item is out and the next reservation decides by when it has to be back.
 * The data comes from the booking page loader's `nextReservations`. When the
 * reader may see other members' bookings the badge is a link to that
 * booking, reachable by keyboard; otherwise it names no booking.
 *
 * @see {@link file://../../modules/booking/next-reservations.server.ts}
 */
import { useLoaderData } from "react-router";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import type {
  NextReservation,
  NextReservations,
} from "~/modules/booking/next-reservations.server";
import { AvailabilityBadge } from "./availability-label";
import { Button } from "../shared/button";

/**
 * Read the loader's next reservations, if the page carries them.
 *
 * @returns The map, or `undefined` on pages without it
 */
export function useNextReservations(): NextReservations | undefined {
  const data = useLoaderData<{ nextReservations?: NextReservations }>();
  return data?.nextReservations;
}

/**
 * The next reservation of one asset or kit on the current booking, or
 * nothing when the loader names none for it.
 *
 * Rows on pages whose loader carries no `nextReservations` render nothing
 * and touch no formatting preference, so the row works wherever it is
 * mounted.
 *
 * @param props.kind - Whether `id` names an asset or a kit
 * @param props.id - The asset or kit id
 */
export function NextReservationBadge({
  kind,
  id,
}: {
  kind: "asset" | "kit";
  id: string;
}) {
  const nextReservations = useNextReservations();
  const next =
    kind === "kit"
      ? nextReservations?.byKitId[id]
      : nextReservations?.byAssetId[id];
  if (!next) return null;
  return <NeededBadge kind={kind} next={next} />;
}

/** The badge itself, formatted in the reader's date preferences. */
function NeededBadge({
  kind,
  next,
}: {
  kind: "asset" | "kit";
  next: NextReservation;
}) {
  const { formatDateTime } = useDateFormatter();
  const from = formatDateTime(next.from);
  const badge = (
    <AvailabilityBadge
      badgeText={`Needed ${from}`}
      tooltipTitle="Reserved next by another booking"
      tooltipContent={`${
        next.bookingId ? next.bookingName : "Another booking"
      } has this ${kind} reserved from ${from}. It has to be checked in before then.`}
    />
  );

  // The link is the badge itself, so a keyboard reaches the booking without
  // opening the tooltip. Not a link when the reader may not see it.
  return next.bookingId ? (
    <Button
      to={`/bookings/${next.bookingId}`}
      target="_blank"
      variant="inherit"
      className="inline-block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
      aria-label={`Needed ${from} by ${next.bookingName}, open that booking`}
    >
      {badge}
    </Button>
  ) : (
    badge
  );
}
