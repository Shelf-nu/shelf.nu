/**
 * Availability of a set of asset models over a window the caller names.
 *
 * Serves the model view's create-booking dialog, where the booking does not
 * exist yet: the window is being typed into the same form as the quantities, so
 * the figures have to be measured against dates carried in the request rather
 * than read off a stored booking. The sibling endpoint answers the same
 * question for a booking that already exists.
 *
 * **Both dates are required, and a request without them gets no rows at all.**
 * `bookingWindowOverlap` degrades to an empty predicate when either date is
 * missing, which counts EVERY active booking as competing for the pool. That
 * figure is the worst case, not a neutral one: it is lower than the truth, and
 * rendered as "available" it is a confidently wrong answer. Rows stay hintless
 * until a window exists, which says "not known yet" instead.
 *
 * Every figure is a HINT. It is read outside any transaction and can be stale
 * by the time the booking is created, so nothing may gate on it. The
 * reservation transaction is the only correctness boundary, and it refuses the
 * whole batch at once when a model does not fit.
 *
 * @see {@link file://./../../components/assets/assets-index/model-booking/create-booking-for-models-dialog.tsx} the dialog that reads this
 * @see {@link file://./bookings.$bookingId.model-availability.ts} the same question, for a booking that exists
 * @see {@link file://./../../modules/booking-model-request/service.server.ts} the availability maths
 */

import { DateTime } from "luxon";
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getAssetModelAvailability } from "~/modules/booking-model-request/service.server";
import type { BookingModelAvailabilityRow } from "~/routes/api+/bookings.$bookingId.model-availability";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Most models one request may ask about.
 *
 * Each model costs its own availability computation, several aggregates over
 * assets, custody, booking assets and reservations, so an unbounded list turns
 * one hint into hundreds of queries. A caller over the cap gets a 400 and
 * renders its rows without hints, the same honest "not known yet" state the
 * rows show before a window exists.
 */
export const MAX_MODELS_PER_WINDOW_AVAILABILITY_REQUEST = 100;

/**
 * The body this endpoint answers with, beside the `error` key `payload` stamps.
 *
 * `from` and `to` are echoed exactly as the request spelled them, so a caller
 * holding the previous answer while a new one is in flight can tell which
 * window these figures describe.
 */
export type AssetModelWindowAvailabilityResponse = {
  /** The `from` query value these figures were measured against. */
  from: string;
  /** The `to` query value these figures were measured against. */
  to: string;
  /** One row per asked-about model in this workspace, or none. */
  models: BookingModelAvailabilityRow[];
};

/** Query shape: one `assetModelId` parameter per selected model. */
const WindowAvailabilityQuerySchema = z.object({
  assetModelIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one asset model.")
    .max(
      MAX_MODELS_PER_WINDOW_AVAILABILITY_REQUEST,
      `Ask about at most ${MAX_MODELS_PER_WINDOW_AVAILABILITY_REQUEST} models at a time.`
    ),
});

/**
 * The booking `getAssetModelAvailability` excludes from its reserved sums.
 *
 * That parameter exists so a booking's own holdings do not reduce its own
 * availability. A booking that is still being filled in holds nothing, so there
 * is nothing to exclude, and an id no row can carry leaves every competing
 * reservation counted, which is the whole pool the new window has to fit into.
 */
const NO_BOOKING_TO_EXCLUDE = "";

/**
 * Serves per-model availability for a window given in the query string.
 *
 * Models outside the caller's workspace are left out of the response rather
 * than reported as zero: a row the caller cannot act on has no honest hint to
 * show, and the reservation write refuses it by name anyway.
 *
 * @param args.context - Carries the auth session
 * @param args.request - Read for the active organization, the window and the
 *   model ids
 * @returns `{ from, to, models }`: the window these figures describe, echoed
 *   as asked, and one row per asked-about model in this workspace
 * @throws {Response} 400 for a missing or oversized model list, 403 when the
 *   caller may not create bookings in this workspace
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    // `booking:create` rather than `booking:read`: this endpoint exists for the
    // create flow, so the gate is the one the create itself applies.
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    const url = new URL(request.url);
    const parsedQuery = WindowAvailabilityQuerySchema.safeParse({
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

    const rawFrom = url.searchParams.get("from") ?? "";
    const rawTo = url.searchParams.get("to") ?? "";

    /** The answer for a request that names no usable window. */
    const noWindowResponse: AssetModelWindowAvailabilityResponse = {
      from: rawFrom,
      to: rawTo,
      models: [],
    };

    if (!rawFrom || !rawTo) {
      // No service call at all. Without both dates the availability maths
      // counts every active booking as competing, which is the worst case
      // rather than a neutral one, so there is no number here worth sending.
      return data(payload(noWindowResponse));
    }

    // The wall-clock strings the form emits carry no offset, so they are read
    // in the acting user's RESOLVED preference zone, the same zone the create
    // action parses them in, so the hint measures the window that will be
    // stored.
    const prefs = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );
    const from = DateTime.fromISO(rawFrom, { zone: prefs.timeZone });
    const to = DateTime.fromISO(rawTo, { zone: prefs.timeZone });

    // An unreadable date, or an end at or before its start, is not a window:
    // the overlap predicate would either be empty or describe a span nobody
    // asked for, and both produce a figure that reads as an answer.
    if (!from.isValid || !to.isValid || to.toMillis() <= from.toMillis()) {
      return data(payload(noWindowResponse));
    }

    // Org-scoped read rather than `assertAssetModelsBelongToOrg`: an id from
    // another workspace has no availability to report to this one, and the
    // maths would happily return zeroes that read as a real answer. Filtering
    // is what proves ownership here, and every id handed to the service below
    // came back from this query. Refusing the whole request instead would cost
    // the honest hints of every other model in the selection, which a
    // background read behind a dialog has no way to explain.
    const knownModels = await db.assetModel.findMany({
      where: { id: { in: assetModelIds }, organizationId },
      select: { id: true },
    });

    // Sequential, not `Promise.all`: each call fans out into several aggregates
    // of its own, so a parallel sweep over a full page of models would hold a
    // large share of the connection pool for one hint.
    const models: BookingModelAvailabilityRow[] = [];
    for (const model of knownModels) {
      const availability = await getAssetModelAvailability({
        assetModelId: model.id,
        organizationId,
        bookingId: NO_BOOKING_TO_EXCLUDE,
        from: from.toJSDate(),
        to: to.toJSDate(),
      });

      models.push({
        assetModelId: model.id,
        // A booking that does not exist reserves nothing, so the projected
        // total a row shows is exactly what the user is typing.
        alreadyReserved: 0,
        available: availability.available,
      });
    }

    const response: AssetModelWindowAvailabilityResponse = {
      from: rawFrom,
      to: rawTo,
      models,
    };

    return data(payload(response));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    // No user notification: this is a background read behind a dialog, and its
    // caller degrades to rows without hints. A toast here would announce a
    // failure the user did not ask for and cannot act on, next to a form that
    // still works.
    throw data(error(reason, false), { status: reason.status });
  }
}
