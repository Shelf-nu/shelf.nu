import type { Qr } from "@shelf/database";
import { ErrorCorrection } from "@shelf/database";
import JSZip from "jszip";
import QRCode from "qrcode-generator";
import { getQrBaseUrl } from "~/modules/qr/utils.server";

export async function createQrCodesZip(codes: Qr[]) {
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

    const dateString = `${c.createdAt.getFullYear().toString()}${(
      c.createdAt.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}${c.createdAt.getDate().toString().padStart(2, "0")}`;

    zip.file(`${dateString} - ${c.id}.svg`, svg);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return zipBlob;
}
