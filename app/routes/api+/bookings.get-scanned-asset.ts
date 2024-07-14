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
        bookings: true,
      },
    });

    return json(data({ asset }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
