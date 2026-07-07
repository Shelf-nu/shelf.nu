import { BookingStatus, OrganizationRoles } from "@prisma/client";
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
import { updateBasicBooking } from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
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
 * POST /api/mobile/bookings/update
 *
 * Edits a booking's basic info from the Companion app — the mobile twin of the
 * web "save booking" flow. Wraps the shared `updateBasicBooking` service, which
 * enforces the status-aware field mask: name/description/tags are editable in
 * DRAFT/RESERVED/ONGOING/OVERDUE; from/to + custodian are only applied while the
 * booking is DRAFT; the whole update is rejected for COMPLETE/ARCHIVED/CANCELLED.
 *
 * Parity with web:
 * - Validation runs through the shared {@link BookingFormSchema} with
 *   `action: "save"` + the booking's current status (so active bookings only
 *   validate name/custodian/tags, DRAFTs validate dates too).
 * - SELF_SERVICE / BASE users may only edit their own bookings and may only
 *   assign themselves as custodian.
 * - Bookings are a TEAM-plan feature (`assertMobileCanUseBookings`).
 *
 * Reschedules of a *non-DRAFT* booking are intentionally out of scope here —
 * those go through a dedicated reserve/extend path that re-checks conflicts.
 *
 * Body (JSON): {
 *   bookingId, name, startDate, endDate, timeZone, custodianTeamMemberId,
 *   description?, tags?: string[]
 * }
 * Query: ?orgId=...
 *
 * @see {@link file://./bookings.create.ts} the create counterpart
 */

const BodySchema = z.object({
  bookingId: z.string().min(1),
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  custodianTeamMemberId: z.string().min(1, "Please select a custodian"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  timeZone: z.string().min(1, "Time zone is required"),
  tags: z.array(z.string()).optional().default([]),
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
      action: PermissionAction.update,
    });

    await assertMobileCanUseBookings(organizationId);

    const body = BodySchema.parse(await request.json());

    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;
    const isAdminOrOwner = !isSelfServiceOrBase;

    // Org-scoped lookup — gives us the current status (drives validation +
    // which fields actually apply) and the custodian for the ownership check.
    const existing = await db.booking.findFirst({
      where: { id: body.bookingId, organizationId },
      select: { id: true, status: true, custodianUserId: true },
    });

    if (!existing) {
      return data(
        { error: { message: "Booking not found in this workspace." } },
        { status: 404 }
      );
    }

    // Self-service / base users may only edit their own bookings.
    if (isSelfServiceOrBase && existing.custodianUserId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "You can only edit your own bookings.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Validate + org-scope the custodian team member (cross-org IDOR guard).
    const custodian = await getTeamMember({
      id: body.custodianTeamMemberId,
      organizationId,
      select: { id: true, name: true, userId: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected custodian could not be found.",
        additionalData: {
          userId,
          custodianTeamMemberId: body.custodianTeamMemberId,
        },
        label: "Booking",
        status: 404,
      });
    });

    // Self-service / base may only assign a booking to themselves.
    if (isSelfServiceOrBase && custodian.userId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "Self user can assign booking to themselves only.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const hints: ClientHint = {
      ...getClientHint(request),
      timeZone: body.timeZone,
    };

    // Business-rule validation via the shared web schema. The "save" action +
    // current status picks the right rule set (active bookings skip the date
    // rules; DRAFTs validate future/buffer/working-hours/max-length).
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);

    try {
      BookingFormSchema({
        hints,
        action: "save",
        status: existing.status,
        workingHours,
        bookingSettings,
        isAdminOrOwner,
      }).parse({
        id: body.bookingId,
        name: body.name,
        description: body.description,
        custodian: JSON.stringify({
          id: custodian.id,
          name: custodian.name,
          userId: custodian.userId,
        }),
        startDate: body.startDate,
        endDate: body.endDate,
        tags: body.tags.join(","),
      });
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        throw new ShelfError({
          cause,
          message: cause.errors[0]?.message ?? "Invalid booking details.",
          label: "Booking",
          status: 400,
          shouldBeCaptured: false,
        });
      }
      throw cause;
    }

    // Dates + custodian only apply to DRAFT bookings (updateBasicBooking
    // re-gates this internally); parse the dates only when they will be used.
    const isDraft = existing.status === BookingStatus.DRAFT;
    const from = isDraft
      ? DateTime.fromFormat(body.startDate, DATE_TIME_FORMAT, {
          zone: body.timeZone,
        }).toJSDate()
      : undefined;
    const to = isDraft
      ? DateTime.fromFormat(body.endDate, DATE_TIME_FORMAT, {
          zone: body.timeZone,
        }).toJSDate()
      : undefined;

    const booking = await updateBasicBooking({
      id: body.bookingId,
      organizationId,
      name: body.name,
      description: body.description ?? null,
      from,
      to,
      custodianTeamMemberId: custodian.id,
      custodianUserId: custodian.userId ?? null,
      tags: body.tags.map((id) => ({ id })),
      userId: user.id,
      hints,
    });

    return data({
      booking: {
        id: booking.id,
        name: booking.name,
        status: booking.status,
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
