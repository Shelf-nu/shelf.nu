import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { BOOKING_RESERVE_BLOCKED_LABELS } from "@shelf/labels";
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
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import {
  getBookingFlags,
  reserveBooking,
} from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { getClientHint, type ClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { isValidTimeZone } from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
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
  // Must be a real IANA zone — see `bookings.create.ts`.
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

    // `reserve` maps to `PermissionAction.create` on web (intent2ActionMap).
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });

    await assertMobileCanUseBookings(organizationId);

    const { bookingId, timeZone } = await parseMobileBody(BodySchema, request);

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
        // Needed for the same Reserve eligibility check the web form runs.
        bookingAssets: { select: { assetId: true } },
        modelRequests: { select: { id: true } },
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

    /**
     * Status first, eligibility second.
     *
     * `reserveBooking` refuses anything that is not DRAFT anyway, but it does
     * so AFTER this route's eligibility block. Two devices on one booking is
     * the ordinary case: A reserves it, B's stale detail screen still shows
     * DRAFT and B taps Reserve. If that booking also holds an unavailable
     * asset, checking eligibility first sends B hunting for an asset to fix
     * when the real answer is "someone already reserved this". Answering with
     * the status also skips the eligibility queries on a request that cannot
     * succeed.
     */
    if (booking.status !== BookingStatus.DRAFT) {
      throw new ShelfError({
        cause: null,
        message: `This booking is already ${booking.status.toLowerCase()}. Only DRAFT bookings can be reserved.`,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    /**
     * Reserve eligibility, matching the web form exactly.
     *
     * Web disables its Reserve button when a booking has neither assets nor
     * model requests, or when it holds an asset marked unavailable. Those
     * checks lived only in the web UI, so the phone could reserve a booking
     * the website refuses — an empty reservation reserves nothing, and an
     * unavailable asset is unavailable on either surface. The repo's own rule
     * (see `bookings.checkin.ts`) is that the app must never be more
     * permissive than the web, so this is enforced server-side where no client
     * can skip it.
     *
     * Already-booked assets are NOT re-checked here: `reserveBooking` runs its
     * own conflict validation inside the transaction, which is both the
     * race-safe place for it and the one that can name the offending assets.
     * The companion greys Reserve out for that case from the
     * `hasAlreadyBookedAssets` flag on the booking detail payload, so this
     * route refusing it a second time would only trade a precise message for
     * a vague one.
     */
    const flags = await getBookingFlags({
      id: booking.id,
      organizationId,
      assetIds: booking.bookingAssets.map((ba) => ba.assetId),
      // A booking with no concrete assets but a model-level reservation is
      // still a valid thing to reserve — same door web leaves open.
      modelRequestCount: booking.modelRequests.length,
      from: booking.from,
      to: booking.to,
    });

    if (!flags.hasAssets && !flags.hasModelRequests) {
      throw new ShelfError({
        cause: null,
        message: BOOKING_RESERVE_BLOCKED_LABELS.NOTHING_TO_RESERVE,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    if (flags.hasUnavailableAssets) {
      throw new ShelfError({
        cause: null,
        message: BOOKING_RESERVE_BLOCKED_LABELS.UNAVAILABLE_ASSETS,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const hints: ClientHint = {
      ...getClientHint(request),
      timeZone,
    };

    // TIMEZONE FIX: evaluate the booking's wall-clock in the acting user's
    // RESOLVED preference zone, matching the web reserve action. Falls back to
    // the device zone above when no preference is stored. See `bookings.create.ts`.
    const prefs = await resolveUserFormatPrefsById(userId, hints);

    // Full validation parity with the web reserve action. The stored dates are
    // round-tripped to the form's local-string shape so the shared schema's
    // working-hours / buffer / max-length rules apply.
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);

    // Format and re-parse in the SAME zone the schema validates in, otherwise
    // this round-trip would shift the instant it is meant to preserve.
    const startDate = DateTime.fromJSDate(booking.from)
      .setZone(prefs.timeZone)
      .toFormat(DATE_TIME_FORMAT);
    const endDate = DateTime.fromJSDate(booking.to)
      .setZone(prefs.timeZone)
      .toFormat(DATE_TIME_FORMAT);

    try {
      BookingFormSchema({
        prefs,
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
    // why: message-only by contract. The companion's shared API client
    // flattens every response to `json.error.message` (lib/api/client.ts) and
    // supplies its own alert heading, so a `title` on the errors above would
    // never reach a user. Keep refusal messages self-contained sentences
    // rather than relying on a heading to complete them.
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
