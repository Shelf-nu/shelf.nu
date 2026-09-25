/**
 * Reservation context for a set of asset models on one booking.
 *
 * Answers the two questions the model view's "add to existing booking" dialog
 * has once a booking is picked, for exactly the models the user selected: how
 * many units of each that booking already reserves, and how many are free in
 * its window.
 *
 * Both numbers are HINTS. They are read outside any transaction and can be
 * stale by the time the user submits, so nothing may gate on them — the
 * reservation transaction is the only correctness boundary, and it refuses the
 * whole batch at once when a model does not fit.
 *
 * Reads the two facts directly rather than through `getBookingModelTabData`:
 * that helper caps its model list at `MODEL_PICKER_LIMIT` sorted by name, and
 * a selection is arbitrary rather than the first page of it. A model past the
 * cap would come back absent, and absent reads as "nothing reserved, no
 * availability known" — a confident wrong hint exactly where the additive
 * warning matters most.
 *
 * @see {@link file://./../../components/assets/assets-index/model-booking/add-models-to-existing-booking-dialog.tsx}
 * @see {@link file://./../../modules/booking-model-request/service.server.ts}
 */

import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getAssetModelAvailability } from "~/modules/booking-model-request/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Most models one request may ask about.
 *
 * Each model costs its own availability computation — several aggregates over
 * assets, custody, booking assets and reservations — so an unbounded list
 * turns one hint into hundreds of queries. The cap is generous enough for a
 * full page of selected models and small enough that the endpoint cannot
 * starve the connection pool. A caller over the cap gets a 400 and renders its
 * rows without hints, which is the same honest "no window known yet" state the
 * rows show before a booking is picked.
 */
export const MAX_MODELS_PER_AVAILABILITY_REQUEST = 100;

/** What the booking holds of one model, and what is free around it. */
export type BookingModelAvailabilityRow = {
  /** `AssetModel.id`, echoed so the caller can match rows to its selection. */
  assetModelId: string;
  /** Units this booking already reserves of the model. `0` when none. */
  alreadyReserved: number;
  /**
   * Units free in the booking's window, EXCLUDING this booking's own
   * holdings — so a projected total may be compared against it directly.
   */
  available: number;
};

/** Query shape: one `assetModelId` parameter per selected model. */
const ModelAvailabilityQuerySchema = z.object({
  assetModelIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one asset model.")
    .max(
      MAX_MODELS_PER_AVAILABILITY_REQUEST,
      `Ask about at most ${MAX_MODELS_PER_AVAILABILITY_REQUEST} models at a time.`
    ),
});

/**
 * Serves the per-model reservation context for one booking.
 *
 * Models that are not in the caller's workspace are left out of the response
 * rather than reported as zero: a row the caller cannot act on has no honest
 * hint to show, and the write refuses it by name anyway.
 *
 * @param args.context - Carries the auth session
 * @param args.request - Read for the active organization and the query
 * @param args.params - Carries `bookingId`
 * @returns `{ bookingId, models }` — the booking these figures describe, and
 *   one row per selected model in this workspace
 * @throws {Response} 400 for a missing/oversized model list, 404 when the
 *   booking is not in this workspace, 403 when a restricted caller does not
 *   own it
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, role, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.read,
      });

    const url = new URL(request.url);
    const parsedQuery = ModelAvailabilityQuerySchema.safeParse({
      assetModelIds: url.searchParams.getAll("assetModelId"),
    });

    if (!parsedQuery.success) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        status: 400,
        message:
          parsedQuery.error.issues[0]?.message ?? "Invalid model selection.",
        shouldBeCaptured: false,
      });
    }

    const { assetModelIds } = parsedQuery.data;

    // Scoped to the workspace, so a booking id from another org is a 404 here
    // rather than a window this caller gets to measure availability against.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        from: true,
        to: true,
        creatorId: true,
        custodianUserId: true,
      },
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

    // `booking:read` reaches SELF_SERVICE and BASE for every booking id in the
    // workspace, so the same ownership gate the reservation write applies has
    // to stand here too — otherwise this endpoint reports how much a
    // colleague's booking reserves of each model.
    if (isSelfServiceOrBase) {
      validateBookingOwnership({
        booking,
        userId,
        role,
        action: "view model reservations on",
      });
    }

    // Org-scoped: an id from another workspace has no availability to report
    // to this one, and the availability maths would happily return zeroes
    // that read as a real answer.
    const knownModels = await db.assetModel.findMany({
      where: { id: { in: assetModelIds }, organizationId },
      select: { id: true },
    });
    const knownModelIds = knownModels.map((model) => model.id);

    const reservations = await db.bookingModelRequest.findMany({
      where: { bookingId, assetModelId: { in: knownModelIds } },
      select: { assetModelId: true, quantity: true },
    });
    const reservedByModel = new Map(
      reservations.map((row) => [row.assetModelId, row.quantity])
    );

    // Sequential, not `Promise.all`: each call fans out into several
    // aggregates of its own, so a parallel sweep over a full page of models
    // would hold a large share of the connection pool for one hint.
    const models: BookingModelAvailabilityRow[] = [];
    for (const assetModelId of knownModelIds) {
      const availability = await getAssetModelAvailability({
        assetModelId,
        organizationId,
        // Excludes this booking's own holdings, so the caller compares a
        // projected total against the figure directly.
        bookingId,
        from: booking.from,
        to: booking.to,
      });

      models.push({
        assetModelId,
        alreadyReserved: reservedByModel.get(assetModelId) ?? 0,
        available: availability.available,
      });
    }

    // `bookingId` is echoed so a caller can tell whose window these figures
    // describe. A client that keeps the previous answer while a new one is in
    // flight would otherwise show one booking's reservations under another's
    // name — a hint that is wrong rather than missing.
    return data(payload({ bookingId: booking.id, models }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    // No user notification: this is a background read behind a dialog, and its
    // caller degrades to rows without hints. A toast here would announce a
    // failure the user did not ask for and cannot act on, next to a form that
    // still works.
    throw data(error(reason, false), { status: reason.status });
  }
}
