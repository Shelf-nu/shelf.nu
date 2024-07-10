import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { updateKit } from "~/modules/kit/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl } from "~/utils/storage.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { kitId, image } = parseData(
      await request.formData(),
      z.object({
        kitId: z.string(),
        image: z.string(),
      })
    );

    const url = new URL(image);
    const path = url.pathname;

    const start = path.indexOf("/kits/");

    const filename = start !== -1 ? path.slice(start + "/kits/".length) : null;

    if (!filename) {
      throw new ShelfError({
        cause: null,
        message: "Cannot find kit filename",
        additionalData: { userId, kitId, image },
        label: "Kit",
      });
    }

    const signedUrl = await createSignedUrl({ filename, bucketName: "kits" });

    const kit = await updateKit({
      id: kitId,
      image: signedUrl,
      imageExpiration: oneDayFromNow(),
      createdById: userId,
    });

    return json(data({ kit }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}
