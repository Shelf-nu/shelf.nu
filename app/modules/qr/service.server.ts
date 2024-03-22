import type { Organization, Qr, User } from "@prisma/client";
import QRCode from "qrcode-generator";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { gifToPng } from "~/utils/gif-to-png";
import { getCurrentSearchParams } from "~/utils/http.server";

const label: ErrorLabel = "QR";

export async function getQrByAssetId({ assetId }: Pick<Qr, "assetId">) {
  try {
    return await db.qr.findFirst({
      where: { assetId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the QR. Please try again or contact support.",
      additionalData: { assetId },
      label,
    });
  }
}

export async function getQr(id: Qr["id"]) {
  try {
    return await db.qr.findFirst({
      where: { id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the QR. Please try again or contact support.",
      additionalData: { id },
      label,
    });
  }
}

export async function createQr({
  userId,
  assetId,
  organizationId,
}: Pick<Qr, "userId" | "organizationId"> & { assetId: string }) {
  const data = {
    user: {
      connect: {
        id: userId,
      },
    },
    asset: {
      connect: {
        id: assetId,
      },
    },
    organization: {
      connect: {
        id: organizationId,
      },
    },
  };

  return db.qr.create({
    data,
  });
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
  try {
    const code = QRCode(version, errorCorrection);
    code.addData(`${process.env.SERVER_URL}/qr/${qr.id}`);
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

export async function generateOrphanedCodes({
  userId,
  amount,
  organizationId,
}: {
  userId: User["id"];
  amount: number;
  organizationId: Organization["id"];
}) {
  try {
    const data = Array.from({ length: amount }).map(() => ({
      userId,
      organizationId,
    }));

    return await db.qr.createMany({
      data: data,
      skipDuplicates: true,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to generate orphaned codes",
      additionalData: { userId, amount, organizationId },
      label,
    });
  }
}

export async function assertWhetherQrBelongsToCurrentOrganization({
  request,
  organizationId,
}: {
  request: Request;
  organizationId: Organization["id"];
}) {
  const searchParams = getCurrentSearchParams(request);
  const qrId = searchParams.get("qrId");

  try {
    /** We have the case when someone could be linking a QR that doesnt belong to the current org */
    if (qrId) {
      await db.qr.findUniqueOrThrow({
        where: {
          id: qrId,
          organizationId,
        },
      });
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "This QR code doesn't exist or it doesn't belong to your current organization. A new asset cannot be linked to it.",
      title: "QR code not found",
      status: 403,
      additionalData: { qrId, organizationId },
      label,
    });
  }
}
