import type { Organization, Qr, User } from "@prisma/client";
import QRCode from "qrcode-generator";
import { db } from "~/database";
import { getCurrentSearchParams, gifToPng } from "~/utils";
import { ShelfStackError } from "~/utils/error";

export async function getQrByAssetId({ assetId }: Pick<Qr, "assetId">) {
  return db.qr.findFirst({
    where: { assetId },
  });
}

export async function getQr(id: Qr["id"]) {
  return db.qr.findFirst({
    where: { id },
  });
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
  const data = Array.from({ length: amount }).map(() => ({
    userId,
    organizationId,
  }));

  return await db.qr.createMany({
    data: data,
    skipDuplicates: true,
  });
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
  /** We have the case when someone could be linking a QR that doesnt belong to the current org */
  if (qrId) {
    const qr = await db.qr.findUnique({
      where: {
        id: qrId,
        organizationId,
      },
    });
    if (!qr)
      throw new ShelfStackError({
        message:
          "This QR code doesn't belong to your current organization. A new asset cannot be linked to it.",
        title: "Not allowed",
        status: 403,
      });
  }
}
