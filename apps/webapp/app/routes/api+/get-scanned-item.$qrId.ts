import type { Prisma } from "@prisma/client";
import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getQr } from "~/modules/qr/service.server";
import {
  getScannerPickerMeta,
  ScannerPickerContextSchema,
  type ScannerPickerMeta,
} from "~/modules/scanner/picker-meta.server";
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
import {
  sanitizeAssetExtraInclude,
  sanitizeKitExtraInclude,
} from "~/utils/scanner-extra-include.server";
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

    const {
      assetExtraInclude,
      kitExtraInclude,
      auditSessionId,
      pickerContext,
    } = parseData(
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
        /**
         * JSON-encoded `{ type: "location" | "kit" | "booking", id }`.
         * When present, the loader attaches a normalised picker MAX
         * to the asset response (`pickerMeta`) so the scanner drawer
         * can show "· X available" and bound its qty input — matching
         * the manage-assets picker UX.
         */
        pickerContext: z
          .string()
          .optional()
          .transform((val, ctx) => {
            if (!val) return undefined;
            try {
              return ScannerPickerContextSchema.parse(JSON.parse(val));
            } catch (e) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Invalid pickerContext: ${
                  e instanceof Error ? e.message : "parse error"
                }`,
              });
              return z.NEVER;
            }
          }),
      })
    ) as {
      assetExtraInclude: Prisma.AssetInclude | undefined;
      kitExtraInclude: Prisma.KitInclude | undefined;
      auditSessionId?: string;
      pickerContext?: ReturnType<typeof ScannerPickerContextSchema.parse>;
    };

    // SECURITY (CWE-94 / overfetch): assetExtraInclude/kitExtraInclude are
    // user-controlled JSON. Allowlist them before merging into the Prisma
    // include so relation traversal / deep nesting cannot be injected.
    const assetInclude: Prisma.AssetInclude = {
      ...ASSET_INCLUDE,
      ...(sanitizeAssetExtraInclude(assetExtraInclude) ?? {}),
    };

    const kitInclude: Prisma.KitInclude = {
      ...KIT_INCLUDE,
      ...(sanitizeKitExtraInclude(kitExtraInclude) ?? {}),
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

      // If audit session ID provided, fetch the auditAssetId and counts
      let auditAssetId: string | undefined;
      let auditNotesCount = 0;
      let auditImagesCount = 0;
      if (auditSessionId && asset.id) {
        const auditAsset = await db.auditAsset.findFirst({
          where: {
            auditSessionId,
            assetId: asset.id,
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

      // When the scanner provides a destination (location / kit /
      // booking), attach the same strict-available pool the
      // manage-assets picker shows so the row label + qty input bound
      // are consistent across both UX surfaces.
      const pickerMeta: ScannerPickerMeta | null =
        pickerContext && asset.id
          ? await getScannerPickerMeta({
              assetId: asset.id,
              organizationId,
              context: pickerContext,
            })
          : null;

      return data(
        payload({
          qr: {
            type: "asset" as const,
            asset: {
              ...asset,
              auditAssetId,
              auditNotesCount,
              auditImagesCount,
              pickerMeta,
            },
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

    // If audit session ID provided, fetch the auditAssetId and counts
    let auditAssetId: string | undefined;
    let auditNotesCount = 0;
    let auditImagesCount = 0;
    if (auditSessionId && qr.asset?.id) {
      const auditAsset = await db.auditAsset.findFirst({
        where: {
          auditSessionId,
          assetId: qr.asset.id,
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

    // See the sequential-id branch above for context. Same attachment
    // shape so consumers can read `qr.asset.pickerMeta` regardless of
    // which lookup matched.
    const pickerMeta: ScannerPickerMeta | null =
      pickerContext && qr.asset?.id
        ? await getScannerPickerMeta({
            assetId: qr.asset.id,
            organizationId,
            context: pickerContext,
          })
        : null;

    return data(
      payload({
        qr: {
          ...qr,
          type: qr.asset ? "asset" : qr.kit ? "kit" : undefined,
          asset: qr.asset
            ? {
                ...qr.asset,
                auditAssetId,
                auditNotesCount,
                auditImagesCount,
                pickerMeta,
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
