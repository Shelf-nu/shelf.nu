import { OrganizationRoles } from "@prisma/client";
import { DateTime } from "luxon";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BookingFormSchema } from "~/components/booking/forms/forms-schema";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { reserveBooking } from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { enforceUserRateLimit } from "~/utils/rate-limit.server";

/**
 * POST /api/mobile/bookings/reserve
 *
 * Transitions a DRAFT booking to RESERVED from the Companion app — the mobile
 * twin of the web "reserve" intent. Wraps the shared `reserveBooking` service,
 * which runs the authoritative server-side conflict re-check (so two devices
 * can't double-book the same asset), schedules the check-out reminder and sends
 * the reservation emails.
 *
 * Unlike the web form (which submits the edited fields), the mobile flow is a
 * one-tap "Reserve" on an existing draft, so we read the draft's current values
 * and pass them through. Validation runs through the shared {@link
 * BookingFormSchema} with `action: "reserve"` for full parity (future + buffer +
 * working-hours + max-length), on top of `reserveBooking`'s own date + conflict
 * checks.
 *
 * Permission: `reserve` maps to `PermissionAction.create` (web `intent2ActionMap`),
 * so self-service users — who can create bookings — can also reserve their own.
 *
 * Body: { bookingId: string, timeZone: string (IANA) }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.$bookingId.overview.tsx} web twin (reserve intent)
 */

const BodySchema = z.object({
  bookingId: z.string().min(1),
  timeZone: z.string().min(1, "Time zone is required"),
});

export async function action({ request }: ActionFunctionArgs) {
  let userId: string | undefined;

  try {
    const { user } = await requireMobileAuth(request);
    userId = user.id;
    await enforceUserRateLimit(user.id, "bulk");

    const organizationId = await requireOrganizationAccess(request, user.id);

    // `reserve` maps to `PermissionAction.create` on web (intent2ActionMap).
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId, timeZone } = BodySchema.parse(await request.json());

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;
    const isAdminOrOwner = !isSelfServiceOrBase;

    // Read the draft's current values; the mobile "Reserve" tap transitions it
    // to RESERVED without re-entering the form.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        status: true,
        name: true,
        description: true,
        from: true,
        to: true,
        custodianUserId: true,
        custodianTeamMemberId: true,
        custodianTeamMember: { select: { id: true, name: true, userId: true } },
        tags: { select: { id: true } },
      },
    });

    if (!booking) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Self-service / base users may only reserve their own bookings.
    if (isSelfServiceOrBase && booking.custodianUserId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "You can only reserve your own bookings.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    if (!booking.from || !booking.to) {
      throw new ShelfError({
        cause: null,
        message: "Booking dates are missing. Add dates before reserving.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    if (!booking.custodianTeamMemberId) {
      throw new ShelfError({
        cause: null,
        message: "Booking has no custodian. Add a custodian before reserving.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const hints: ClientHint = {
      ...getClientHint(request),
      timeZone,
    };

    // Full validation parity with the web reserve action. The stored dates are
    // round-tripped to the form's local-string shape so the shared schema's
    // working-hours / buffer / max-length rules apply.
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);

    const startDate = DateTime.fromJSDate(booking.from)
      .setZone(timeZone)
      .toFormat(DATE_TIME_FORMAT);
    const endDate = DateTime.fromJSDate(booking.to)
      .setZone(timeZone)
      .toFormat(DATE_TIME_FORMAT);

    try {
      BookingFormSchema({
        hints,
        action: "reserve",
        status: booking.status,
        workingHours,
        bookingSettings,
        isAdminOrOwner,
      }).parse({
        id: booking.id,
        name: booking.name,
        description: booking.description ?? undefined,
        custodian: JSON.stringify({
          id: booking.custodianTeamMember?.id,
          name: booking.custodianTeamMember?.name ?? "",
          userId:
            booking.custodianTeamMember?.userId ?? booking.custodianUserId,
        }),
        startDate,
        endDate,
        tags: booking.tags.map((t) => t.id).join(","),
      });
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        throw new ShelfError({
          cause,
          message: cause.errors[0]?.message ?? "Booking cannot be reserved.",
          label: "Booking",
          status: 400,
          shouldBeCaptured: false,
        });
      }
      throw cause;
    }

    const reserved = await reserveBooking({
      id: booking.id,
      organizationId,
      name: booking.name,
      description: booking.description ?? undefined,
      from: booking.from,
      to: booking.to,
      custodianTeamMemberId: booking.custodianTeamMemberId,
      custodianUserId: booking.custodianUserId ?? undefined,
      tags: booking.tags.map((t) => ({ id: t.id })),
      hints,
      isSelfServiceOrBase,
      userId: user.id,
    });

    return data({
      booking: {
        id: reserved.id,
        name: reserved.name,
        status: reserved.status,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
