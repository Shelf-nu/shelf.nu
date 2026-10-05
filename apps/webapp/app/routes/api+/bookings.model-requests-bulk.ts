/**
 * Reserve units of several asset models on one existing booking.
 *
 * The write behind the model view's "add to existing booking" dialog. One
 * request carries one booking and a quantity per selected model; the service
 * commits every reservation in a single transaction, so a batch with one model
 * short leaves the booking exactly as it was.
 *
 * Reservations are `BookingModelRequest` rows — an intent to supply N units of
 * a model, with no concrete asset named. Units become real `BookingAsset` rows
 * later, when they are scanned or assigned on the booking.
 *
 * @see {@link file://./../../components/assets/assets-index/model-booking/add-models-to-existing-booking-dialog.tsx}
 * @see {@link file://./../../modules/booking-model-request/service.server.ts}
 */

import { data, type ActionFunctionArgs } from "react-router";
import { addModelsToExistingBookingSchema } from "~/components/assets/assets-index/model-booking/add-models-to-existing-booking-dialog";
import { db } from "~/database/db.server";
import { upsertBookingModelRequests } from "~/modules/booking-model-request/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Writes the batch of reservations.
 *
 * @param args.context - Carries the auth session
 * @param args.request - The POSTed form
 * @returns `{ success: true, bookingId }` on a committed batch, or the
 *   service's own error with its status, so the dialog can name the model that
 *   was short
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.update,
      });

    const formData = await request.formData();
    const { bookingId, models } = parseData(
      formData,
      addModelsToExistingBookingSchema,
      { additionalData: { userId } }
    );

    // Scoped to the workspace: `bookingId` comes from the form, so a booking
    // in another org must not be reachable through it.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { id: true, name: true, creatorId: true, custodianUserId: true },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        title: "Not found",
        status: 404,
        message: "Booking not found.",
        shouldBeCaptured: false,
      });
    }

    // `booking:update` reaches SELF_SERVICE and BASE for every booking in the
    // workspace, so org scoping alone would still let them reserve units on a
    // colleague's booking.
    if (isSelfServiceOrBase) {
      validateBookingOwnership({
        booking,
        userId,
        role,
        action: "manage model reservations on",
      });
    }

    /**
     * Forwarded exactly as submitted.
     *
     * `additions` is units to ADD. The service reads what the booking already
     * reserves of each model and sums, because the write underneath takes an
     * absolute target. Adding the existing quantity here as well would double
     * it — and the write would still succeed, so nothing anywhere would report
     * it. Whatever this route is tempted to compute, the summing belongs to
     * the transaction that reads the current quantity under a lock.
     */
    const { requests } = await upsertBookingModelRequests({
      bookingId,
      organizationId,
      userId,
      additions: models,
    });

    sendNotification({
      title: "Models reserved",
      message: `Reserved units of ${requests.length} model${
        requests.length === 1 ? "" : "s"
      } on ${booking.name}.`,
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    return data(payload({ success: true, bookingId: booking.id }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    // Returned, never thrown: the dialog reads the message out of the body and
    // renders it beside the rows, which is where the user can act on "there
    // are only N units of X free". The notification is suppressed for the same
    // reason — a toast would repeat the sentence already on screen.
    return data(error(reason, false), { status: reason.status });
  }
}
