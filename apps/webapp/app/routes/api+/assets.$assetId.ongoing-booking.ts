/**
 * The booking that currently holds a checked-out asset, for the asset status
 * badge's hover card.
 *
 * Applies the rule the mobile asset detail applies to the same question
 * (`activeBooking` in `api+/mobile+/assets.$assetId.ts`): the booking is named
 * only to viewers who may see who holds it (`canSeeBookingCustodian`), and
 * `canOpen` says whether the booking page will open for them
 * (`canSeeBooking`). Every other case answers `{ booking: null }`.
 *
 * @see {@link file://./../../components/assets/asset-status-badge/asset-status-badge.tsx}
 * @see {@link file://./mobile+/assets.$assetId.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getOngoingBookingForAsset } from "~/modules/booking/service.server";
import {
  canSeeBooking,
  canSeeBookingCustodian,
} from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** The booking the badge names, and whether its page opens for the viewer. */
export type OngoingBookingSummary = {
  id: string;
  name: string;
  canOpen: boolean;
};

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
      booking &&
      canSeeBookingCustodian({
        canSeeAllCustody: access.custody.seeAll,
        booking: {
          custodianUser: booking.custodianUserId
            ? { id: booking.custodianUserId }
            : null,
          custodianTeamMember: booking.custodianTeamMember,
        },
        userId,
      })
        ? {
            id: booking.id,
            name: booking.name,
            canOpen: canSeeBooking({ access, booking, userId }),
          }
        : null;

    return data(
      payload({
        booking: visible,
        /**
         * `id` and `name` also sit at the top level, where browser tabs still
         * running a bundle without the `booking` key read them. Both are
         * already in `booking`, so this exposes nothing it does not.
         */
        ...(visible ? { id: visible.id, name: visible.name } : {}),
      } satisfies OngoingBookingPayload &
        Partial<Pick<OngoingBookingSummary, "id" | "name">>)
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    throw data(error(reason), { status: reason.status });
  }
}
