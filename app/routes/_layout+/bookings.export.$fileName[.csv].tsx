import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { exportBookingsFromIndexToCsv } from "~/utils/csv.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getCurrentSearchParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertCanUseBookings } from "~/utils/subscription.server";

export const ExportBookingsSchema = z.object({
  bookingIds: z.array(z.string()).min(1),
});

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { currentOrganization, canSeeAllBookings } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.export,
    });

    assertCanUseBookings(currentOrganization);

    const searchParams = getCurrentSearchParams(request);
    const bookingsIds = searchParams.get("bookingsIds");

    if (!bookingsIds) {
      throw new ShelfError({
        cause: null,
        message: "No bookings selected",
        label: "Booking",
      });
    }

    /** Join the rows with a new line */
    const csvString = await exportBookingsFromIndexToCsv({
      request,
      bookingsIds: bookingsIds.split(","),
      userId,
      canSeeAllBookings,
      currentOrganization,
    });

    return new Response(csvString, {
      status: 200,
      headers: {
        "content-type": "text/csv",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
};
