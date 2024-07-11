import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";
import { createQrCodesZip } from "~/utils/zip-qr-codes";

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
          ...(onlyOrphaned
            ? { assetId: null, kitId: null }
            : {
                OR: [
                  {
                    assetId: {
                      not: null,
                    },
                  },
                  {
                    kitId: {
                      not: null,
                    },
                  },
                ],
              }),
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

    const zipBlob = await createQrCodesZip(codes);

    return new Response(zipBlob, {
      headers: { "content-type": "application/zip" },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
