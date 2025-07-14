import type { Prisma } from "@prisma/client";
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  data,
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
        message: "Barcode scanning is not enabled for this organization.",
        additionalData: { shouldSendNotification: false },
        label: "Barcode",
        shouldBeCaptured: false,
        status: 403,
      });
    }

    const { value } = getParams(params, z.object({ value: z.string() }), {
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

    return json(
      data({
        barcode: {
          ...barcode,
          type: barcode.asset ? "asset" : barcode.kit ? "kit" : undefined,
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
