import type { Qr, User } from "@prisma/client";
import QRCode from "qrcode-generator";
import { db } from "~/database";
import { gifToPng } from "~/utils";

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
}: Pick<Qr, "userId"> & { assetId: string }) {
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
}: {
  userId: User["id"];
  amount: number;
}) {
  const data = Array.from({ length: amount }).map(() => ({ userId }));

  return await db.qr.createMany({
    data: data,
    skipDuplicates: true, // Skip 'Bobo'
  });
}
