/**
 * The booking that currently holds a checked-out asset, for the asset status
 * badge's hover card.
 *
 * Answers `{ booking: { id, name } }` only when the viewer may see that
 * booking (`canSeeBooking`); every other case answers `{ booking: null }`.
 *
 * @see {@link file://./../../components/assets/asset-status-badge/asset-status-badge.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getOngoingBookingForAsset } from "~/modules/booking/service.server";
import { canSeeBooking } from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** The booking the badge links to: just enough to name it and open it. */
export type OngoingBookingSummary = { id: string; name: string };

/** What the loader answers. */
export type OngoingBookingPayload = { booking: OngoingBookingSummary | null };

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, z.object({ assetId: z.string() }));

  try {
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const booking = await getOngoingBookingForAsset({
      assetId,
      organizationId,
    });

    const visible =
      booking && canSeeBooking({ access, booking, userId })
        ? { id: booking.id, name: booking.name }
        : null;

    return data(payload<OngoingBookingPayload>({ booking: visible }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}
