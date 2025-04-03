import type { Prisma } from "@prisma/client";
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

const CUSTODY_INCLUDE = {
  custody: {
    select: {
      custodian: {
        select: {
          name: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
        },
      },
    },
  },
};

const ASSET_INCLUDE = {
  bookings: true,
  location: {
    select: {
      id: true,
      name: true,
    },
  },
  ...CUSTODY_INCLUDE,
};

const KIT_INCLUDE = {
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
  ...CUSTODY_INCLUDE,
};

const QR_INCLUDE = {
  asset: {
    include: ASSET_INCLUDE,
  },
  kit: {
    include: KIT_INCLUDE,
  },
};

export type QrForScannerType = Prisma.QrGetPayload<{
  include: typeof QR_INCLUDE;
}>;

export type KitFromQr = Prisma.KitGetPayload<{
  include: typeof KIT_INCLUDE;
}>;

export type AssetFromQr = Prisma.AssetGetPayload<{
  include: typeof ASSET_INCLUDE;
}>;

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
      include: QR_INCLUDE,
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
