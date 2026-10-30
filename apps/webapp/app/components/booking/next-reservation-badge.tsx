/**
 * The badge on a running booking's item row naming the booking the item is
 * promised to next, and from when.
 *
 * Rendered only while the booking is ONGOING or OVERDUE: that is when the
 * item is out and the next reservation decides by when it has to be back.
 * The data comes from the booking page loader's `nextReservations`.
 *
 * @see {@link file://../../modules/booking/next-reservations.server.ts}
 */
import { useLoaderData } from "react-router";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import type { NextReservations } from "~/modules/booking/next-reservations.server";
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
 * The next reservation of one asset or kit on the current booking.
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
  const { formatDateTime } = useDateFormatter();
  const next =
    kind === "kit"
      ? nextReservations?.byKitId[id]
      : nextReservations?.byAssetId[id];
  if (!next) return null;

  const from = formatDateTime(next.from);
  return (
    <AvailabilityBadge
      badgeText={`Needed ${from}`}
      tooltipTitle="Reserved next by another booking"
      tooltipContent={
        <span>
          <Button
            to={`/bookings/${next.bookingId}`}
            target="_blank"
            variant="inherit"
            className="!underline"
          >
            {next.bookingName}
          </Button>{" "}
          has this {kind} reserved from {from}. It has to be checked in before
          then.
        </span>
      }
    />
  );
}
