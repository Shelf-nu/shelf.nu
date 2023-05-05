import type { Qr } from "@prisma/client";
import QRCode from "qrcode-generator";
import { db } from "~/database";
import { gifToPng } from "~/utils";

export async function getQrByItemId({ itemId }: Pick<Qr, "itemId">) {
  return db.qr.findFirst({
    where: { itemId },
  });
}

export async function getQr(id: Qr["id"]) {
  return db.qr.findFirst({
    where: { id },
  });
}

export async function createQr({
  userId,
  itemId,
}: Pick<Qr, "userId"> & { itemId: string }) {
  const data = {
    user: {
      connect: {
        id: userId,
      },
    },
    item: {
      connect: {
        id: itemId,
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

  const sizes = {
    cable: [1, 6], // 45px => 1.2cm(1.19)
    small: [2, 14], // 94px => 2.5cm(2.48)
    medium: [4, 19], // 170px => 4.5cm(4.49)
    large: [6], // 246px => 6.50cm
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
