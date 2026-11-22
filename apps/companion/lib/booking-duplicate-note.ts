/**
 * The message shown after a booking is duplicated, naming what the copy left
 * out: archived assets, which cannot be booked, and model reservations capped
 * at what the new dates have free.
 *
 * Reads the payload of `POST /api/mobile/bookings/duplicate`; the producer side
 * is pinned in
 * `apps/webapp/test/routes-tests/api+/mobile+/bookings.duplicate.test.ts`. The
 * sentences come from `@shelf/labels`, so the web toast says the same.
 *
 * This module must stay free of React Native, Expo and `@/` imports: its test
 * runs under Node's test runner.
 *
 * @see ./booking-duplicate-note.test.ts
 */

import { modelReservationsReduced } from "@shelf/labels";
import { archivedLeftOutNote } from "./archived-assets";
import type { BookingMutationResponse } from "./api/types";

/**
 * What a duplicate left out, as one message.
 *
 * @param response - The duplicate endpoint's payload. Both fields are absent
 *   from servers that predate them, and then read as nothing left out.
 * @returns The message, or `null` when the copy is complete
 */
export function duplicateLeftOutNote(
  response: Pick<
    BookingMutationResponse,
    "droppedArchivedCount" | "reducedModelReservations"
  >
): string | null {
  const parts = [
    archivedLeftOutNote(response.droppedArchivedCount),
    response.reducedModelReservations?.length
      ? modelReservationsReduced(response.reducedModelReservations)
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}
