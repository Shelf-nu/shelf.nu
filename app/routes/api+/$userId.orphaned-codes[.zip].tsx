import { ErrorCorrection } from "@prisma/client";
import { type LoaderArgs } from "@remix-run/node";
import JSZip from "jszip";
import QRCode from "qrcode-generator";
import { db } from "~/database";
import { requireAdmin } from "~/utils/roles.servers";

export const loader = async ({ request, params }: LoaderArgs) => {
  requireAdmin(request);
  const { userId } = params;

  const codes = await db.qr.findMany({
    where: {
      userId,
      assetId: null,
    },
  });
  const zip = new JSZip();

  codes.forEach((c, index) => {
    const code = QRCode(0, ErrorCorrection["L"]);
    code.addData(`${process.env.SERVER_URL}/qr/${c.id}`);
    code.make();
    const svg = code.createSvgTag({ cellSize: 3, margin: 0, scalable: true });

    zip.file(`${index + 1} - ${c.id}.svg`, svg);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return new Response(zipBlob, {
    headers: { "content-type": "application/zip" },
  });
};
