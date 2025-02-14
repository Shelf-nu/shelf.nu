import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { BulkArchiveBookingsSchema } from "~/components/booking/bulk-archive-dialog";
import { BulkCancelBookingsSchema } from "~/components/booking/bulk-cancel-dialog";
import { BulkDeleteBookingSchema } from "~/components/booking/bulk-delete-dialog";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import {
  bulkArchiveBookings,
  bulkCancelBookings,
  bulkDeleteBookings,
} from "~/modules/booking/service.server";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { getClientHint } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();

    const { intent, currentSearchParams } = parseData(
      formData,
      z
        .object({
          intent: z.enum(["bulk-delete", "bulk-archive", "bulk-cancel"]),
        })
        .and(CurrentSearchParamsSchema)
    );

    const intentToActionMap: Record<typeof intent, PermissionAction> = {
      "bulk-delete": PermissionAction.delete,
      "bulk-archive": PermissionAction.update,
      "bulk-cancel": PermissionAction.update,
    };

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: intentToActionMap[intent],
    });

    switch (intent) {
      case "bulk-delete": {
        const { bookingIds } = parseData(formData, BulkDeleteBookingSchema);

        await bulkDeleteBookings({
          bookingIds,
          organizationId,
          userId,
          hints: getClientHint(request),
          currentSearchParams,
        });

        sendNotification({
          title: "Bookings deleted",
          message: "Your bookings has been deleted successfully",
          icon: { name: "trash", variant: "error" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }

      case "bulk-archive": {
        const { bookingIds } = parseData(formData, BulkArchiveBookingsSchema);

        await bulkArchiveBookings({
          bookingIds,
          organizationId,
          currentSearchParams,
        });

        sendNotification({
          title: "Bookings archived",
          message: "Your bookings has been archived successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }

      case "bulk-cancel": {
        const { bookingIds } = parseData(formData, BulkCancelBookingsSchema);

        await bulkCancelBookings({
          bookingIds,
          organizationId,
          userId,
          hints: getClientHint(request),
          currentSearchParams,
        });

        sendNotification({
          title: "Bookings cancelled",
          message: "Your bookings has been cancelled successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(data({ success: true }));
      }

      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
