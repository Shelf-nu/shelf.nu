import type { Organization, Qr, User } from "@prisma/client";
import { isLikeShelfError, ShelfError } from "~/utils/error";
// eslint-disable-next-line import/no-cycle
import {
  createQr,
  generateCode,
  getQrByAssetId,
  getQrByKitId,
} from "./service.server";

export async function generateQrObj({
  kitId,
  assetId,
  userId,
  organizationId,
}: {
  kitId?: Qr["kitId"];
  assetId?: Qr["assetId"];
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    if (!kitId && !assetId) {
      throw new ShelfError({
        cause: null,
        message: "No kitId or assetId provided",
        label: "QR",
      });
    }

    let qr: Qr | null = null;

    if (assetId) {
      qr = await getQrByAssetId({ assetId });
    } else if (kitId) {
      qr = await getQrByKitId({ kitId });
    }

    /** If for some reason there is no QR, we create one and return it */
    if (!qr) {
      qr = await createQr({
        assetId: assetId || undefined,
        kitId: kitId || undefined,
        userId,
        organizationId,
      });
    }

    /** Create a QR code with a URL */
    const { sizes, code } = await generateCode({
      version: qr.version as TypeNumber,
      errorCorrection: qr.errorCorrection as ErrorCorrectionLevel,
      size: "medium",
      qr,
    });

    return {
      qr: code,
      sizes,
      showSidebar: true,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to find qr code",
      additionalData: { kitId, assetId, organizationId, userId },
      label: "QR",
    });
  }
}

export const belongsToCurrentUser = (qr: Qr, userId: User["id"]) =>
  qr.userId === userId;

export const belongsToCurrentUsersOrg = (
  qr: Qr,
  orgs?: Organization[]
): boolean => Boolean(orgs?.find(({ id }) => id === qr.organizationId));
