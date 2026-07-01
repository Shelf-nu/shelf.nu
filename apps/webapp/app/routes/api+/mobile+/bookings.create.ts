import { OrganizationRoles } from "@prisma/client";
import { DateTime } from "luxon";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BookingFormSchema } from "~/components/booking/forms/forms-schema";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
  assertMobileCanUseBookings,
} from "~/modules/api/mobile-auth.server";
import { createBooking } from "~/modules/booking/service.server";
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
 * POST /api/mobile/bookings/create
 *
 * Creates a booking (always DRAFT) from the Companion app — the mobile twin of
 * the web "new booking" flow (`_layout+/bookings.new.tsx`). Wraps the shared
 * `createBooking` service so the org-scoped IDOR guards, `BOOKING_CREATED` /
 * `BOOKING_ASSETS_ADDED` activity events and the DRAFT-forcing logic stay
 * identical to web — assets/kits are added afterwards via the scan/picker flow,
 * exactly like the web "create then manage-assets" sequence.
 *
 * Parity with the web action:
 * - Business validation runs through the shared {@link BookingFormSchema}
 *   (future-date + buffer + working-hours + max-length + required-tags),
 *   parameterised by the org's working hours / booking settings and whether the
 *   caller is admin/owner (admins bypass buffer + max-length).
 * - SELF_SERVICE / BASE users may only assign a booking to themselves.
 * - Bookings are a TEAM-plan feature (`assertCanUseBookings`).
 *
 * Cookie-less native clients can't send the client-hint timezone cookie, so the
 * device IANA `timeZone` is read from the body (same convention as
 * `bookings.checkout`). Dates are local strings in `DATE_TIME_FORMAT`.
 *
 * Body (JSON): {
 *   name: string,
 *   startDate: string ("yyyy-MM-dd'T'HH:mm"),
 *   endDate: string,
 *   timeZone: string (IANA),
 *   custodianTeamMemberId: string,
 *   description?: string,
 *   tags?: string[],     // tag ids
 *   assetIds?: string[]  // pre-selected assets (optional)
 * }
 * Query: ?orgId=...
 *
 * @see {@link file://../../_layout+/bookings.new.tsx} web twin
 */

const BodySchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  custodianTeamMemberId: z.string().min(1, "Please select a custodian"),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
  timeZone: z.string().min(1, "Time zone is required"),
  tags: z.array(z.string()).optional().default([]),
  assetIds: z.array(z.string()).optional().default([]),
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
      action: PermissionAction.create,
    });

    // Premium / org-type gate — bookings are a TEAM-plan feature (mobile twin
    // of the web route-layer gate).
    await assertMobileCanUseBookings(organizationId);

    const body = BodySchema.parse(await request.json());

    // Resolve the caller's role to branch self-service rules + admin bypass.
    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfServiceOrBase =
      role === OrganizationRoles.SELF_SERVICE ||
      role === OrganizationRoles.BASE;
    const isAdminOrOwner = !isSelfServiceOrBase;

    // Validate + org-scope the custodian team member. `getTeamMember` is
    // org-scoped, so a foreign-org team member id 404s here (cross-org IDOR
    // guard) — mirrors the web action.
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

    // Self-service / base users may only assign a booking to themselves.
    if (isSelfServiceOrBase && custodian.userId !== user.id) {
      throw new ShelfError({
        cause: null,
        message: "Self user can assign booking to themselves only.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Native clients send the device timezone in the body (no CH cookie).
    const hints: ClientHint = {
      ...getClientHint(request),
      timeZone: body.timeZone,
    };

    // Business-rule validation via the shared web schema. We shape the JSON body
    // into the form-data shape the schema expects (custodian as a JSON string,
    // tags as a comma-separated string) so the rules stay byte-identical to web.
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);

    try {
      BookingFormSchema({
        hints,
        action: "new",
        workingHours,
        bookingSettings,
        isAdminOrOwner,
      }).parse({
        name: body.name,
        description: body.description,
        assetIds: body.assetIds,
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
        // Surface the first user-facing validation message (e.g. "Start date
        // must be at least N hours from now") as a 400, not a 500.
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

    // BookingFormSchema validates the dates with the broader `coerceLocalDate`,
    // so a value can pass validation yet not match DATE_TIME_FORMAT here and
    // become an Invalid Date. Guard explicitly before handing dates to the
    // service (otherwise `Invalid Date` would silently flow into createBooking).
    const fromDt = DateTime.fromFormat(body.startDate, DATE_TIME_FORMAT, {
      zone: body.timeZone,
    });
    const toDt = DateTime.fromFormat(body.endDate, DATE_TIME_FORMAT, {
      zone: body.timeZone,
    });
    if (!fromDt.isValid || !toDt.isValid) {
      throw new ShelfError({
        cause: null,
        message: "Invalid booking start or end date.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }
    const from = fromDt.toJSDate();
    const to = toDt.toJSDate();

    const booking = await createBooking({
      booking: {
        name: body.name,
        description: body.description ?? null,
        from,
        to,
        // Custodian team member is always connected; the linked user (if the
        // team member maps to a registered user) is derived from the DB record,
        // never trusted from the client.
        custodianTeamMemberId: custodian.id,
        custodianUserId: custodian.userId ?? null,
        organizationId,
        creatorId: user.id,
        tags: body.tags.map((id) => ({ id })),
      },
      assetIds: body.assetIds,
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
