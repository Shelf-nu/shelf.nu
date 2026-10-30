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
import { isExtendableStatus } from "~/modules/booking/extend-eligibility";
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
 * Moves the end of an ONGOING or OVERDUE booking, from the Companion app.
 * The mobile twin of the web "extend-booking" intent: it wraps the same
 * `extendBooking` service, which re-checks clashes with reserved bookings and
 * model reservations when the end moves later, flips OVERDUE back to ONGOING,
 * writes the activity note, sends the emails and reschedules the check-in
 * reminder.
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
 * - The service accepts an earlier or a later end, as long as it is after the
 *   start and in the future, and refuses a write that races another end-date
 *   change or a close, for web and phone alike. The Companion app's sheet
 *   still offers only later ends.
 *
 * `endDate` is a wall clock with no offset, decoded in the `timeZone` the
 * client declares (see `bookings.update.ts`). The response's `to` is read from
 * the service's result, the end it stored, never from the parsed input.
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
      action: "change the end date of",
    });

    // Checked before the dates: a closed booking answers with its status, not
    // with a date rule it could never satisfy.
    if (!isExtendableStatus(booking.status)) {
      throw new ShelfError({
        cause: null,
        message:
          "Changing the end date is not allowed for the current booking status.",
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
    // the way inside it, each with the items it holds.
    const clashing = clashingBookingLabels(reason.additionalData);
    const message =
      clashing.length > 0
        ? `${reason.message} ${clashing.join(", ")}`
        : reason.message;
    return data({ error: { message } }, { status: reason.status });
  }
}

/**
 * Labels of the bookings an extension would overlap, read from the service's
 * `additionalData.clashingBookings`: the booking's name, followed by the
 * shared items in parentheses when the payload names them.
 *
 * @param additionalData - The error's additional data, of any shape
 * @returns One label per clashing booking; empty when the error is not a clash
 */
function clashingBookingLabels(additionalData: unknown): string[] {
  if (typeof additionalData !== "object" || additionalData === null) return [];
  const clashing = (additionalData as { clashingBookings?: unknown })
    .clashingBookings;
  if (!Array.isArray(clashing)) return [];
  return clashing.flatMap((b: { name?: unknown; items?: unknown } | null) => {
    if (typeof b?.name !== "string") return [];
    const items = Array.isArray(b.items)
      ? b.items.flatMap((item: { name?: unknown } | null) =>
          typeof item?.name === "string" ? [item.name] : []
        )
      : [];
    return [items.length > 0 ? `${b.name} (${items.join(", ")})` : b.name];
  });
}
