/**
 * Shared submitted shape for a batch of model reservations.
 *
 * Both entry points from the asset index's model view post the same thing — a
 * list of models and how many units of each — so they parse it with the same
 * schema rather than two that drift. Kept out of any `*.server` module because
 * the dialogs validate against it in the browser as well as the actions on the
 * server.
 *
 * @see {@link file://./../../routes/api+/bookings.create-for-models.ts}
 * @see {@link file://./../../routes/api+/bookings.model-requests-bulk.ts}
 */
import { z } from "zod";

/**
 * The `models` field: one entry per model, with the units wanted for it.
 *
 * Models are posted as indexed form fields (`models[0].assetModelId`,
 * `models[0].quantity`, …), which `parseData` rebuilds into an array before
 * this schema sees it. `quantity` is coerced because a form field is always a
 * string.
 *
 * A model listed twice is accepted, not refused. Both writers fold repeats
 * into one absolute target before writing — `upsertBookingModelRequests` sums
 * them, and `createBooking` sums them — so two entries for one model add up.
 * Refusing them here would reject something the services handle correctly, and
 * would differ between two sibling routes that take the same input.
 *
 * @param emptyMessage - What to say when nothing is selected. The two call
 * sites word this differently because one books and the other reserves onto a
 * booking that already exists.
 */
export function modelReservationsField(emptyMessage: string) {
  return (
    z
      .array(
        z.object({
          assetModelId: z.string().min(1, "Asset model ID is required"),
          quantity: z.coerce
            .number()
            .int()
            .min(1, "Quantity must be a positive integer"),
        })
      )
      .min(1, emptyMessage)
      // A submission carrying no `models[…]` fields at all reads as an empty
      // list, so it is refused by the same message as an emptied one rather
      // than by Zod's bare "Required".
      .default([])
  );
}
