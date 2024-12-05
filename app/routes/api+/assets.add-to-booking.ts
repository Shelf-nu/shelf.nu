import { json, type ActionFunctionArgs } from "@remix-run/node";
import { addAssetsToExistingBookingSchema } from "~/components/assets/assets-index/add-assets-to-existing-booking-dialog";
import {
  processBooking,
  upsertBooking,
} from "~/modules/booking/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { getClientHint } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { intersected } from "~/utils/utils";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const userId = authSession.userId;

  try {
    assertIsPost(request);

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const { id, assetsIds, addOnlyRestAssets } = parseData(
      formData,
      addAssetsToExistingBookingSchema,
      {
        additionalData: { userId },
      }
    );

    let { finalAssetIds, bookingInfo } = await processBooking(id, assetsIds);

    /**
     * Remove already added assets and proceed with not added assets.
     */
    if (addOnlyRestAssets) {
      const bookingAssetIds = bookingInfo.assets.map((asset) => asset.id);
      finalAssetIds = finalAssetIds.filter(
        (assetId) => !bookingAssetIds.includes(assetId)
      );
    }

    if (
      bookingInfo.assets.length &&
      intersected(
        bookingInfo.assets.map((a) => a.id),
        finalAssetIds
      )
    ) {
      throw new ShelfError({
        cause: null,
        message:
          "The booking you have selected already contains the asset you are trying to add. Please select a different booking.",
        additionalData: {
          alreadyAddedAssets: bookingInfo.assets.filter((asset) =>
            finalAssetIds.includes(asset.id)
          ),
        },
        label: "Booking",
      });
    }

    const user = await getUserByID(userId);
    const booking = await upsertBooking(
      {
        id,
        assetIds: finalAssetIds,
      },
      getClientHint(request)
    );

    await createNotes({
      content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** added asset to booking **[${
        booking.name
      }](/bookings/${booking.id})**.`,
      type: "UPDATE",
      userId: authSession.userId,
      assetIds: finalAssetIds,
    });

    sendNotification({
      title: "Booking Updated",
      message: "Your booking has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}
