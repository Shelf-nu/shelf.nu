import { data, type LoaderFunctionArgs } from "react-router";
import { getMinimalBookings } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { canManageBookingItems } from "~/utils/permissions/role-access";
import { requirePermission } from "~/utils/roles.server";

/** The open statuses an "add to existing booking" picker can offer. */
const ADDABLE_STATUSES = ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"] as const;

/**
 * Bookings the caller may add assets to, for the "add to existing booking"
 * dialog.
 *
 * Returns the slim projection — name and dates only — because the dialog
 * renders nothing else and filters client-side.
 *
 * A restricted caller (SELF_SERVICE / BASE) sees only their own. "Their own"
 * spans both custody links: a booking may name them through the user link or
 * through any team-member row they hold, and matching the user link alone hides
 * the ones assigned before that link existed.
 *
 * @param args.context - Carries the auth session
 * @param args.request - Read for the active organization
 * @returns `{ bookings }` — DRAFT, RESERVED, ONGOING and OVERDUE only
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.read,
    });

    // The "add to existing booking" dialog renders only a name + date range and
    // filters client-side, so fetch the slim projection (no per-booking asset /
    // kit / custodian tree, no count query) instead of the full index shape.
    const { bookings } = await getMinimalBookings({
      organizationId,
      userId,
      // Open bookings the caller may still add items to. Roles with
      // `bookings.manageItemsAfterDraft` also target RESERVED/ONGOING/OVERDUE
      // (added assets stay AVAILABLE: progressive checkout); the rest see
      // only drafts, the same rule the add actions enforce.
      statuses: ADDABLE_STATUSES.filter((bookingStatus) =>
        canManageBookingItems({ access, bookingStatus })
      ),
      // This list feeds the add-to-existing-booking write picker, so it
      // follows the WRITE scope, not visibility. Custody may sit on the user
      // link or on a team-member link; the service resolves both.
      ...(!access.bookings.writeAll && { restrictToCustodian: true }),
    });

    return data(payload({ bookings }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}
