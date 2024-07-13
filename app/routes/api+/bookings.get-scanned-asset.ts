import { BookingStatus } from "@prisma/client";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getAsset } from "~/modules/asset/service.server";
import { getQr } from "~/modules/qr/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, data, error, parseData } from "~/utils/http.server";

export async function action({ request, context }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();

    const { qrId } = parseData(
      formData,
      z.object({ qrId: z.string(), bookingId: z.string() }),
      {
        additionalData: { userId },
      }
    );

    const qr = await getQr(qrId);

    if (!qr.assetId || !qr.organizationId) {
      throw new ShelfError({
        cause: null,
        message: "QR is not associated with any asset yet.",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    const asset = await getAsset({
      id: qr.assetId,
      organizationId: qr.organizationId,
      include: {
        custody: true,
        bookings: {
          where: {
            status: {
              notIn: [
                BookingStatus.ARCHIVED,
                BookingStatus.CANCELLED,
                BookingStatus.COMPLETE,
              ],
            },
          },
          select: { id: true, status: true },
        },
      },
    });

    // const isPartOfCurrentBooking = asset.bookings.some(
    //   (b) => b.id === bookingId
    // );

    // /** Asset is already added in the booking */
    // if (isPartOfCurrentBooking) {
    //   throw new ShelfError({
    //     cause: null,
    //     title: "Already added",
    //     message: "This asset is already added in the current booking.",
    //     label: "Booking",
    //     shouldBeCaptured: false,
    //   });
    // }

    // /** Asset is not available for booking */
    // if (!asset.availableToBook) {
    //   throw new ShelfError({
    //     cause: null,
    //     title: "Unavailable",
    //     message:
    //       "This asset is marked as unavailable for bookings by administrator.",
    //     label: "Booking",
    //     shouldBeCaptured: false,
    //   });
    // }

    // /** Asset is in custody */
    // if (asset.custody) {
    //   throw new ShelfError({
    //     cause: null,
    //     title: "In custody",
    //     message:
    //       "This asset is in custody of team member making it currently unavailable for bookings.",
    //     label: "Booking",
    //     shouldBeCaptured: false,
    //   });
    // }

    // /** Is booked for period */
    // if (
    //   asset.bookings.length > 0 &&
    //   asset.bookings.some((b) => b.id !== bookingId)
    // ) {
    //   throw new ShelfError({
    //     cause: null,
    //     title: "Already booked",
    //     message:
    //       "This asset is added to a booking that is overlapping the selected time period.",
    //     label: "Booking",
    //     shouldBeCaptured: false,
    //   });
    // }

    // /** If currently checked out */
    // if (asset.status === AssetStatus.CHECKED_OUT) {
    //   throw new ShelfError({
    //     cause: null,
    //     title: "Checked out",
    //     message:
    //       "This asset is currently checked out as part of another booking and should be available for your selected date range period",
    //     label: "Booking",
    //     shouldBeCaptured: false,
    //   });
    // }

    // /** Asset is part of a kit */
    // if (asset.kitId) {
    //   throw new ShelfError({
    //     cause: null,
    //     title: "Part of kit",
    //     message: "Remove the asset from the kit to add it individually.",
    //     label: "Booking",
    //     shouldBeCaptured: false,
    //   });
    // }

    return json(data({ asset }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
