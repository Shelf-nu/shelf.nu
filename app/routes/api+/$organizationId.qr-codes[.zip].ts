import { ErrorCorrection } from "@prisma/client";
import { type LoaderFunctionArgs } from "@remix-run/node";
import JSZip from "jszip";
import QRCode from "qrcode-generator";
import { db } from "~/database";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  requireAdmin(request);
  const { organizationId } = params;
  const url = new URL(request.url);
  const onlyOrphaned = url.searchParams.get("orphaned");

  const codes = await db.qr.findMany({
    where: {
      organizationId,
      assetId: onlyOrphaned
        ? null
        : {
            not: null,
          },
    },
  });
  const zip = new JSZip();

  codes.forEach((c) => {
    const code = QRCode(0, ErrorCorrection["L"]);
    code.addData(`${process.env.SERVER_URL}/qr/${c.id}`);
    code.make();
    const svg = code.createSvgTag({ cellSize: 3, margin: 0, scalable: true });

    const dateString = `${c.createdAt.getFullYear().toString()}${(
      c.createdAt.getMonth() + 1
    )
      .toString()
      .padStart(2, "0")}${c.createdAt.getDate().toString().padStart(2, "0")}`;

    zip.file(`${dateString} - ${c.id}.svg`, svg);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return new Response(zipBlob, {
    headers: { "content-type": "application/zip" },
  });
};
