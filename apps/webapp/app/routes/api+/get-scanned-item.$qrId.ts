import type { Prisma } from "@prisma/client";
import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import type { AssetWithResolvableImage } from "~/modules/asset/image-resolution";
import { serializeAssetImage } from "~/modules/asset/image-resolution";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
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

/**
 * A barcode row carrying just what this loader needs to answer with.
 *
 * `getBarcodeByValue` is generic over its `include` and returns `any`, so
 * annotating the call site is what keeps the fallback's payload typed. Only
 * the relations are declared: the fallback decides what a barcode resolves to
 * from the loaded asset or kit, the same way the QR branch does.
 */
type ScannedBarcodeMatch = {
  asset: (AssetWithResolvableImage & { id: string }) | null;
  kit: KitFromScanner | null;
};

/**
 * Serialize an asset the way every lookup in this loader answers with it.
 *
 * Collapses the model-image cascade into the flat image fields the scanner
 * drawers read — the nested relation is dropped so the row carries one source
 * of truth for the image — then attaches the audit counters and, when the
 * scanner named a destination, the same strict-available pool the
 * manage-assets picker shows.
 *
 * Shared by all three lookups (SAM id, QR code, SAM-shaped barcode) so a
 * scanned asset carries identical fields whichever one matched.
 *
 * @param args.asset - The asset row, fetched with `ASSET_INCLUDE`.
 * @param args.organizationId - The caller's workspace, for the picker bound.
 * @param args.auditSessionId - Audit session to count notes and images against.
 * @param args.pickerContext - Destination the scanner is filling, if any.
 * @returns The asset as the endpoint responds with it.
 */
async function serializeScannedAsset<
  T extends AssetWithResolvableImage & { id: string },
>({
  asset,
  organizationId,
  auditSessionId,
  pickerContext,
}: {
  asset: T;
  organizationId: string;
  auditSessionId?: string;
  pickerContext?: ReturnType<typeof ScannerPickerContextSchema.parse>;
}) {
  let auditAssetId: string | undefined;
  let auditNotesCount = 0;
  let auditImagesCount = 0;

  if (auditSessionId) {
    const auditAsset = await db.auditAsset.findFirst({
      where: { auditSessionId, assetId: asset.id },
      select: { id: true },
    });
    auditAssetId = auditAsset?.id;

    if (auditAssetId) {
      const [notesCount, imagesCount] = await Promise.all([
        db.auditNote.count({ where: { auditSessionId, auditAssetId } }),
        db.auditImage.count({ where: { auditSessionId, auditAssetId } }),
      ]);
      auditNotesCount = notesCount;
      auditImagesCount = imagesCount;
    }
  }

  const pickerMeta: ScannerPickerMeta | null = pickerContext
    ? await getScannerPickerMeta({
        assetId: asset.id,
        organizationId,
        context: pickerContext,
      })
    : null;

  return {
    ...serializeAssetImage(asset),
    auditAssetId,
    auditNotesCount,
    auditImagesCount,
    pickerMeta,
  };
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const searchParams = getCurrentSearchParams(request);

  try {
    const { organizationId, canUseBarcodes } = await requirePermission({
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

      if (asset) {
        return data(
          payload({
            qr: {
              type: "asset" as const,
              asset: await serializeScannedAsset({
                asset,
                organizationId,
                auditSessionId,
                pickerContext,
              }),
            },
          })
        );
      }

      // A printed label can carry a SAM-shaped value that the workspace
      // registered as a BARCODE rather than as an asset's SAM id. Scanner mode
      // (keyboard wedge or typed input) tests the SAM pattern before anything
      // else and sends every match here, so without this fallback those labels
      // dead-end on the error below even though the workspace holds the code.
      // Camera scans escape it already: they carry their symbology and go to
      // `get-scanned-barcode` instead.
      //
      // Gated on `canUseBarcodes` — the flag `requirePermission` resolves from
      // the workspace — so this endpoint refuses barcode data on exactly the
      // same terms as its camera-scan sibling.
      const barcode: ScannedBarcodeMatch | null = canUseBarcodes
        ? await getBarcodeByValue({
            // The raw scanned string, not the normalized SAM id: barcode
            // values are matched original-case first, then uppercased.
            value: qrId,
            organizationId,
            include: {
              asset: { include: assetInclude },
              kit: { include: kitInclude },
            },
          })
        : null;

      if (barcode?.asset) {
        return data(
          payload({
            qr: {
              type: "asset" as const,
              asset: await serializeScannedAsset({
                asset: barcode.asset,
                organizationId,
                auditSessionId,
                pickerContext,
              }),
            },
          })
        );
      }

      if (barcode?.kit) {
        return data(
          payload({ qr: { type: "kit" as const, kit: barcode.kit } })
        );
      }

      // Nothing carries this value. A barcode that exists but is linked to
      // neither an asset nor a kit lands here too: it resolves to no item, and
      // the response must not reveal that a row exists for it.
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
          asset: qr.asset
            ? await serializeScannedAsset({
                asset: qr.asset,
                organizationId,
                auditSessionId,
                pickerContext,
              })
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
