import { ErrorCorrection } from "@prisma/client";
import JSZip from "jszip";
import QRCode from "qrcode-generator";
import { getQrBaseUrl } from "~/modules/qr/utils.server";

interface QrCodeForZip {
  id: string;
  createdAt: string | Date;
}

export async function createQrCodesZip(codes: QrCodeForZip[]) {
  const zip = new JSZip();
  const baseUrl = getQrBaseUrl();

  codes.forEach((c) => {
    const code = QRCode(0, ErrorCorrection["L"]);
    code.addData(`${baseUrl}/${c.id}`);
    code.make();
    const svg = code.createSvgTag({
      cellSize: 3,
      margin: 4,
      scalable: true,
    });

    const createdDate = new Date(c.createdAt);
    const dateString = `${createdDate.getFullYear().toString()}${(
      createdDate.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}${createdDate.getDate().toString().padStart(2, "0")}`;

    zip.file(`${dateString} - ${c.id}.svg`, svg);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return zipBlob;
}
