import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { findFirst, count } from "~/database/query-helpers.server";
import { queryRaw, sql } from "~/database/sql.server";
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
      assetExtraInclude: Record<string, unknown> | undefined;
      kitExtraInclude: Record<string, unknown> | undefined;
      auditSessionId?: string;
    };

    const assetInclude: Record<string, unknown> = {
      ...ASSET_INCLUDE,
      ...(assetExtraInclude ?? {}),
    };

    const kitInclude: Record<string, unknown> = {
      ...KIT_INCLUDE,
      ...(kitExtraInclude ?? {}),
    };

    const sequentialId = parseSequentialId(qrId);

    if (sequentialId) {
      const assetRows = await queryRaw<Record<string, any>>(
        db,
        sql`
          SELECT a.*,
                 l."id" as "location_id", l."name" as "location_name",
                 cu."id" as "custody_id", cu."teamMemberId" as "custody_teamMemberId",
                 tm."name" as "custodian_name",
                 u2."firstName" as "custodian_firstName",
                 u2."lastName" as "custodian_lastName",
                 u2."profilePicture" as "custodian_profilePicture"
          FROM "Asset" a
          LEFT JOIN "Location" l ON l."id" = a."locationId"
          LEFT JOIN "Custody" cu ON cu."assetId" = a."id"
          LEFT JOIN "TeamMember" tm ON tm."id" = cu."teamMemberId"
          LEFT JOIN "User" u2 ON u2."id" = tm."userId"
          WHERE a."organizationId" = ${organizationId}
            AND a."sequentialId" = ${sequentialId}
          LIMIT 1
        `
      );

      const assetRow = assetRows[0];
      if (!assetRow) {
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

      // Shape the asset to match the expected include structure
      const asset = {
        ...assetRow,
        location: assetRow.location_id
          ? { id: assetRow.location_id, name: assetRow.location_name }
          : null,
        custody: assetRow.custody_id
          ? {
              id: assetRow.custody_id,
              teamMemberId: assetRow.custody_teamMemberId,
              custodian: {
                name: assetRow.custodian_name,
                user: assetRow.custodian_firstName
                  ? {
                      firstName: assetRow.custodian_firstName,
                      lastName: assetRow.custodian_lastName,
                      profilePicture: assetRow.custodian_profilePicture,
                    }
                  : null,
              },
            }
          : null,
      };

      // If audit session ID provided, fetch the auditAssetId and counts
      let auditAssetId: string | undefined;
      let auditNotesCount = 0;
      let auditImagesCount = 0;
      if (auditSessionId && asset.id) {
        const auditAsset = await findFirst(db, "AuditAsset", {
          where: { auditSessionId, assetId: asset.id },
          select: "id",
        });
        auditAssetId = auditAsset?.id;
        if (auditAssetId) {
          const [notesCount, imagesCount] = await Promise.all([
            count(db, "AuditNote", { auditSessionId, auditAssetId }),
            count(db, "AuditImage", { auditSessionId, auditAssetId }),
          ]);
          auditNotesCount = notesCount;
          auditImagesCount = imagesCount;
        }
      }

      return data(
        payload({
          qr: {
            type: "asset" as const,
            asset: {
              ...asset,
              auditAssetId,
              auditNotesCount,
              auditImagesCount,
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
      const auditAsset = await findFirst(db, "AuditAsset", {
        where: { auditSessionId, assetId: qr.asset.id },
        select: "id",
      });
      auditAssetId = auditAsset?.id;
      if (auditAssetId) {
        const [notesCount, imagesCount] = await Promise.all([
          count(db, "AuditNote", { auditSessionId, auditAssetId }),
          count(db, "AuditImage", { auditSessionId, auditAssetId }),
        ]);
        auditNotesCount = notesCount;
        auditImagesCount = imagesCount;
      }
    }

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
