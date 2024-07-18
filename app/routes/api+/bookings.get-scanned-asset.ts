import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { getAsset } from "~/modules/asset/service.server";
import { getQr } from "~/modules/qr/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const searchParams = new URL(request.url).searchParams;
    const qrId = searchParams.get("qrId");
    const bookingId = searchParams.get("bookingId");

    if (!qrId || !bookingId) {
      throw new ShelfError({
        cause: null,
        message: "Insufficient parameters",
        shouldBeCaptured: false,
        label: "Booking",
      });
    }

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
        bookings: true,
      },
    });

    return json(
      data({
        asset: {
          ...asset,
          qrScanned: qr.id,
        },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
