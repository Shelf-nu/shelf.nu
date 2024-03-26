import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import { updateAsset } from "~/modules/asset";
import {
  ShelfError,
  data,
  error,
  makeShelfError,
  oneDayFromNow,
  parseData,
} from "~/utils";
import { createSignedUrl } from "~/utils/storage.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { assetId, mainImage } = parseData(
      await request.formData(),
      z.object({
        assetId: z.string(),
        mainImage: z.string(),
      })
    );

    const url = new URL(mainImage);
    const path = url.pathname;
    const start = path.indexOf("/assets/");
    const filename =
      start !== -1 ? path.slice(start + "/assets/".length) : null;

    if (!filename) {
      throw new ShelfError({
        cause: null,
        message: "Cannot find filename",
        additionalData: { userId, assetId, mainImage },
        label: "Assets",
      });
    }

    const signedUrl = await createSignedUrl({
      filename,
    });

    const asset = await updateAsset({
      id: assetId,
      mainImage: signedUrl,
      mainImageExpiration: oneDayFromNow(),
      userId,
    });

    return json(data({ asset }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
