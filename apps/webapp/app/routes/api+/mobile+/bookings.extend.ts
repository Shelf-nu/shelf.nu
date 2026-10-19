import { BookingStatus } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { ExtendBookingSchema } from "~/components/booking/forms/forms-schema";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import { extendBooking } from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { isValidTimeZone } from "~/utils/date-format";
import { prefsForDeclaredZone } from "~/utils/date-format.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/extend
 *
 * Moves the end of an ONGOING or OVERDUE booking later, from the Companion app.
 * The mobile twin of the web "extend-booking" intent: it wraps the same
 * `extendBooking` service, which re-checks clashes with reserved bookings and
 * model reservations, flips OVERDUE back to ONGOING, writes the activity note,
 * sends the emails and reschedules the check-in reminder.
 *
 * PARITY with web:
 * - Gated on `PermissionAction.extend` (BASE holds `booking:update` but not
 *   `booking:extend`).
 * - `validateBookingOwnership`: a caller who does not write every booking may
 *   only extend one they created or hold. Web relies on its page loader's read
 *   filter, which a direct POST bypasses.
 * - The new end validates through the shared {@link ExtendBookingSchema}
 *   (future date with buffer, working hours, maximum length), with the
 *   booking's stored start as the schema's start date.
 *
 * Stricter than web: the new end must be after the current end. Web lets an
 * extension shorten a booking as long as the new end is in the future; the
 * phone only ever moves it later. Mobile must never be more permissive than
 * web.
 *
 * `endDate` is a wall clock with no offset, decoded in the `timeZone` the
 * client declares (see `bookings.update.ts`). The response's `to` is read from
 * the service's result, never from the parsed input: the service reuses that
 * Date to schedule the reminder and moves it an hour earlier in place.
 *
 * Body: { bookingId: string, endDate: "yyyy-MM-ddTHH:mm", timeZone: IANA zone }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.tsx} web twin (extend-booking intent)
 */

const BodySchema = z.object({
  bookingId: z.string().min(1),
  endDate: z.string().min(1, "End date is required"),
  timeZone: z
    .string()
    .min(1, "Time zone is required")
    .refine(isValidTimeZone, "Time zone must be a valid IANA zone"),
});

/** Statuses a booking can be extended from, the same set the service allows. */
const EXTENDABLE_STATUSES: BookingStatus[] = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.extend,
    });

    await assertMobileCanUseBookings(organizationId);

    const body = await parseMobileBody(BodySchema, request, "Booking");

    const { access, roles } = await getMobileUserContext(
      user.id,
      organizationId
    );

    const booking = await db.booking.findFirst({
      where: { id: body.bookingId, organizationId },
      select: {
        id: true,
        status: true,
        from: true,
        to: true,
        creatorId: true,
        custodianUserId: true,
      },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    validateBookingOwnership({
      booking,
      userId: user.id,
      access,
      action: "extend",
    });

    // Checked before the dates: a closed booking answers with its status, not
    // with a date rule it could never satisfy.
    if (!EXTENDABLE_STATUSES.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        message: "Extending booking is not allowed for current status.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const prefs = prefsForDeclaredZone(body.timeZone);
    const [workingHours, bookingSettings] = await Promise.all([
      getWorkingHoursForOrganization(organizationId),
      getBookingSettingsForOrganization(organizationId),
    ]);

    let parsed;
    try {
      parsed = ExtendBookingSchema({
        workingHours,
        prefs,
        bookingSettings,
        bypassTimeLimits: access.policy.bookings.bypassTimeLimits,
      }).parse({ startDate: booking.from, endDate: body.endDate });
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        throw new ShelfError({
          cause,
          message: cause.errors[0]?.message ?? "Invalid end date.",
          label: "Booking",
          status: 400,
          shouldBeCaptured: false,
        });
      }
      throw cause;
    }

    if (parsed.endDate <= booking.to) {
      throw new ShelfError({
        cause: null,
        message: "The new end date must be after the current end date.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const hints: ClientHint = {
      ...getClientHint(request),
      timeZone: body.timeZone,
    };

    const updated = await extendBooking({
      id: booking.id,
      organizationId,
      newEndDate: parsed.endDate,
      hints,
      userId: user.id,
      access,
      roles,
      // The check above read `booking.to` outside the service's transaction;
      // this makes the write itself refuse an end that is no longer later.
      requireLaterEnd: true,
    });

    return data({
      booking: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        to: updated.to.toISOString(),
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    // The phone shows only `error.message`, so a clash names the bookings in
    // the way inside it.
    const clashing = clashingBookingNames(reason.additionalData);
    const message =
      clashing.length > 0
        ? `${reason.message} ${clashing.join(", ")}`
        : reason.message;
    return data({ error: { message } }, { status: reason.status });
  }
}

/**
 * Names of the bookings an extension would overlap, read from the service's
 * `additionalData.clashingBookings`.
 *
 * @param additionalData - The error's additional data, of any shape
 * @returns The clashing bookings' names; empty when the error is not a clash
 */
function clashingBookingNames(additionalData: unknown): string[] {
  if (typeof additionalData !== "object" || additionalData === null) return [];
  const clashing = (additionalData as { clashingBookings?: unknown })
    .clashingBookings;
  if (!Array.isArray(clashing)) return [];
  return clashing.flatMap((b: { name?: unknown } | null) =>
    typeof b?.name === "string" ? [b.name] : []
  );
}
