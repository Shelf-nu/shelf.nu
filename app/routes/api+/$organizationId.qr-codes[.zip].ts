import { ErrorCorrection } from "@prisma/client";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import JSZip from "jszip";
import QRCode from "qrcode-generator";
import { z } from "zod";
import { db } from "~/database";
import { error, getParams, makeShelfError, ShelfError } from "~/utils";
import { requireAdmin } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    await requireAdmin(userId);

    const url = new URL(request.url);
    const onlyOrphaned = url.searchParams.get("orphaned");

    const codes = await db.qr
      .findMany({
        where: {
          organizationId,
          assetId: onlyOrphaned
            ? null
            : {
                not: null,
              },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Something went wrong fetching the QR codes.",
          additionalData: { userId, organizationId },
          label: "QR",
        });
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
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
