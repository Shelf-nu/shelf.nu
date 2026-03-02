import type { Prisma } from "@prisma/client";
import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
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
  BARCODE_INCLUDE,
  KIT_INCLUDE,
} from "~/utils/scanner-includes.server";

// Export types for barcode scanning
export type AssetFromBarcode = AssetFromScanner;
export type KitFromBarcode = KitFromScanner;
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const searchParams = getCurrentSearchParams(request);

  try {
    const { organizationId, canUseBarcodes } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset, // Use asset permissions for barcode scanning
      action: PermissionAction.read,
    });

    // Check if organization has barcode permissions enabled
    if (!canUseBarcodes) {
      throw new ShelfError({
        cause: null,
        message:
          "Your workspace does not support scanning barcodes. Contact your workspace owner to activate this feature or try scanning a Shelf QR code.",
        additionalData: { shouldSendNotification: false },
        label: "Barcode",
        shouldBeCaptured: false,
        status: 403,
      });
    }

    const { value: encodedValue } = getParams(
      params,
      z.object({ value: z.string() }),
      {
        additionalData: {
          userId,
        },
      }
    );

    // Decode the URL-encoded barcode value
    const value = decodeURIComponent(encodedValue);

    const { assetExtraInclude, kitExtraInclude, auditSessionId } = parseData(
      searchParams,
      z.object({
        assetExtraInclude: z
          .string()
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            try {
              return JSON.parse(val);
            } catch (_error) {
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
            } catch (_error) {
              throw new Error("Invalid JSON input for kitExtraInclude");
            }
          }),
        auditSessionId: z.string().optional(),
      })
    ) as {
      assetExtraInclude: Prisma.AssetInclude | undefined;
      kitExtraInclude: Prisma.KitInclude | undefined;
      auditSessionId?: string;
    };

    const include = {
      ...BARCODE_INCLUDE,

      // Include additional data based on search params. This will override the default includes
      ...(assetExtraInclude
        ? { asset: { include: { ...ASSET_INCLUDE, ...assetExtraInclude } } }
        : undefined),

      ...(kitExtraInclude
        ? { kit: { include: { ...KIT_INCLUDE, ...kitExtraInclude } } }
        : undefined),
    };

    const barcode = await getBarcodeByValue({
      value,
      organizationId,
      include,
    });

    if (!barcode) {
      throw new ShelfError({
        cause: null,
        message:
          "This barcode doesn't exist or it doesn't belong to your current organization.",
        additionalData: { value, shouldSendNotification: false },
        label: "Barcode",
        shouldBeCaptured: false,
      });
    }

    if (!barcode.assetId && !barcode.kitId) {
      throw new ShelfError({
        cause: null,
        message: "Barcode is not linked to any asset or kit",
        additionalData: { value, shouldSendNotification: false },
        shouldBeCaptured: false,
        label: "Barcode",
      });
    }

    // If audit session ID provided, fetch the auditAssetId and counts
    let auditAssetId: string | undefined;
    let auditNotesCount = 0;
    let auditImagesCount = 0;
    if (auditSessionId && barcode.asset?.id) {
      const auditAsset = await db.auditAsset.findFirst({
        where: {
          auditSessionId,
          assetId: barcode.asset.id,
        },
        select: { id: true },
      });
      auditAssetId = auditAsset?.id;
      if (auditAssetId) {
        const [notesCount, imagesCount] = await Promise.all([
          db.auditNote.count({
            where: {
              auditSessionId,
              auditAssetId,
            },
          }),
          db.auditImage.count({
            where: {
              auditSessionId,
              auditAssetId,
            },
          }),
        ]);
        auditNotesCount = notesCount;
        auditImagesCount = imagesCount;
      }
    }

    return data(
      payload({
        barcode: {
          ...barcode,
          type: barcode.asset ? "asset" : barcode.kit ? "kit" : undefined,
          asset: barcode.asset
            ? {
                ...barcode.asset,
                auditAssetId,
                auditNotesCount,
                auditImagesCount,
              }
            : undefined,
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
