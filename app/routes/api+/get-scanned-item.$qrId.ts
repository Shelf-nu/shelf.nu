import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getQr } from "~/modules/qr/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.read,
    });

    const { qrId } = getParams(params, z.object({ qrId: z.string() }), {
      additionalData: {
        userId,
      },
    });

    const qr = await getQr({
      id: qrId,
      include: {
        asset: {
          include: {
            bookings: true,
          },
        },
        kit: {
          // Fits KitForBooking type
          include: {
            _count: { select: { assets: true } },
            assets: {
              select: {
                id: true,
                status: true,
                availableToBook: true,
                custody: true,
                bookings: { select: { id: true, status: true } },
              },
            },
          },
        },
      },
    });

    if (qr.organizationId !== organizationId) {
      throw new ShelfError({
        cause: null,
        message:
          "This QR code doesn't exist or it doesn't belong to your current organization.",
        additionalData: { qrId, shouldSendNotification: false },
        label: "QR",
        shouldBeCaptured: false,
      });
    }

    if (!qr.assetId && !qr.kitId) {
      throw new ShelfError({
        cause: null,
        message: "QR code is not linked to any asset or kit",
        additionalData: { qrId, shouldSendNotification: false },
        label: "QR",
      });
    }

    return json(
      data({
        qr: {
          ...qr,
          type: qr.asset ? "asset" : qr.kit ? "kit" : undefined,
        },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    const sendNotification = reason.additionalData?.shouldSendNotification;
    const shouldSendNotification =
      typeof sendNotification === "boolean" && sendNotification;

    return json(error(reason, shouldSendNotification), {
      status: reason.status,
    });
  }
}
