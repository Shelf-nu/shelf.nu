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

    const regex =
      // eslint-disable-next-line no-useless-escape
      /\/assets\/([a-f0-9-]+)\/([a-z0-9]+)\/([a-z0-9\-]+\.[a-z]{3,4})/i;
    const match = mainImage.match(regex);

    const filename = match ? `/${match[1]}/${match[2]}/${match[3]}` : null;

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
