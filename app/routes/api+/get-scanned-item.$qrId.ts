import type { Prisma } from "@prisma/client";
import { data } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getQr } from "~/modules/qr/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import type {
  AssetFromScanner,
  KitFromScanner,
} from "~/utils/scanner-includes.server";
import {
  ASSET_INCLUDE,
  KIT_INCLUDE,
  QR_INCLUDE,
} from "~/utils/scanner-includes.server";
import { parseSequentialId } from "~/utils/sequential-id";

// Re-export types for backward compatibility
export type AssetFromQr = AssetFromScanner;
export type KitFromQr = KitFromScanner;

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const searchParams = getCurrentSearchParams(request);

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

    const { assetExtraInclude, kitExtraInclude } = parseData(
      searchParams,
      z.object({
        assetExtraInclude: z
          .string()
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            try {
              return JSON.parse(val);
            } catch (error) {
              throw new Error("Invalid JSON input for assetExtraInclude");
            }
          }),
        kitExtraInclude: z
          .string()
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            try {
              return JSON.parse(val);
            } catch (error) {
              throw new Error("Invalid JSON input for kitExtraInclude");
            }
          }),
      })
    ) as {
      assetExtraInclude: Prisma.AssetInclude | undefined;
      kitExtraInclude: Prisma.KitInclude | undefined;
    };

    const assetInclude: Prisma.AssetInclude = {
      ...ASSET_INCLUDE,
      ...(assetExtraInclude ?? {}),
    };

    const kitInclude: Prisma.KitInclude = {
      ...KIT_INCLUDE,
      ...(kitExtraInclude ?? {}),
    };

    const sequentialId = parseSequentialId(qrId);

    if (sequentialId) {
      const asset = await db.asset.findFirst({
        where: {
          organizationId,
          sequentialId,
        },
        include: assetInclude,
      });

      if (!asset) {
        throw new ShelfError({
          cause: null,
          message:
            "This SAM ID doesn't exist or it doesn't belong to your current organization.",
          title: "SAM ID not found",
          additionalData: { sequentialId, shouldSendNotification: false },
          label: "Scan",
          shouldBeCaptured: false,
        });
      }

      return data(
        payload({
          qr: {
            type: "asset" as const,
            asset,
          },
        })
      );
    }

    const include = {
      ...QR_INCLUDE,
      asset: { include: assetInclude },
      kit: { include: kitInclude },
    };

    const qr = await getQr({
      id: qrId,
      include,
    });

    if (qr.organizationId !== organizationId) {
      throw new ShelfError({
        cause: null,
        message:
          "This code doesn't exist or it doesn't belong to your current organization.",
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
        shouldBeCaptured: false,
        label: "QR",
      });
    }

    return data(
      payload({
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

    return data(error(reason, shouldSendNotification), {
      status: reason.status,
    });
  }
}
