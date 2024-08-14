import type { Organization, Qr, User } from "@prisma/client";
import QRCode from "qrcode-generator";
import { SERVER_URL, URL_SHORTENER } from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { gifToPng } from "~/utils/gif-to-png";
// eslint-disable-next-line import/no-cycle
import { createQr, getQrByAssetId, getQrByKitId } from "./service.server";

const label: ErrorLabel = "QR";

export function getQrBaseUrl() {
  return URL_SHORTENER ? `https://${URL_SHORTENER}` : `${SERVER_URL}/qr`;
}

export async function generateCode({
  version,
  errorCorrection,
  qr,
  size,
}: {
  version: TypeNumber;
  errorCorrection: ErrorCorrectionLevel;
  qr: Qr;
  size: "cable" | "small" | "medium" | "large";
}) {
  const baseUrl = getQrBaseUrl();

  try {
    const code = QRCode(version, errorCorrection);
    code.addData(`${baseUrl}/${qr.id}`);
    code.make();

    /** We use a margin of 0 because we handle this using canvas in the client */
    const sizes = {
      cable: [1, 0], // 29px => 0.8cm(0.77)
      small: [2, 0], // 58px => 1.5cm(1.53)
      medium: [4, 0], // 116px => 3.1cm(3.07)
      large: [6, 0], // 174px => 4.7cm(4.6)
    };
    const src = await gifToPng(code.createDataURL(...sizes[size]));

    return {
      sizes,
      code: {
        size: size,
        src,
        id: qr.id,
      },
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while generating the QR code. Please try again or contact support.",
      additionalData: { version, errorCorrection, qr, size },
      label,
    });
  }
}

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
