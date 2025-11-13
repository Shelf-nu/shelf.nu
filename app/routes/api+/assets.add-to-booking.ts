import type { Prisma } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import { addAssetsToExistingBookingSchema } from "~/components/assets/assets-index/add-assets-to-existing-booking-dialog";
import {
  processBooking,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, payload, error, parseData } from "~/utils/http.server";
import { wrapLinkForNote, wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
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

    const { organizationId } = await requirePermission({
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
      const alreadyAddedAssets = bookingInfo.assets.filter((asset) =>
        finalAssetIds.includes(asset.id)
      );
      const allAssetsInBooking =
        alreadyAddedAssets.length === finalAssetIds.length;

      throw new ShelfError({
        cause: null,
        message: allAssetsInBooking
          ? "The booking you have selected already contains all the selected assets. Please select different booking or different assets."
          : "The booking you have selected already contains the asset you are trying to add. Please select a different booking.",
        additionalData: {
          alreadyAddedAssets,
          allAssetsInBooking,
        },
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Prisma.UserSelect,
    });
    const booking = await updateBookingAssets({
      id,
      organizationId,
      assetIds: finalAssetIds,
    });

    const actor = wrapUserLinkForNote({
      id: authSession.userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    const bookingLink = wrapLinkForNote(
      `/bookings/${booking.id}`,
      booking.name.trim()
    );
    await createNotes({
      content: `${actor} added asset to ${bookingLink}.`,
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

    return payload({ success: true, bookingId: booking.id });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
