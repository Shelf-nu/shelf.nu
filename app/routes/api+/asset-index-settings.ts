import { AssetIndexMode } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";

export const AssetSettingsSchema = z.object({
  mode: z.enum(Object.values(AssetIndexMode) as [AssetIndexMode]),
});

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();

  try {
    const { mode } = parseData(await request.formData(), AssetSettingsSchema);

    console.log("MODE", mode);

    // const url = new URL(mainImage);
    // const path = url.pathname;
    // const start = path.indexOf("/assets/");
    // const filename =
    //   start !== -1 ? path.slice(start + "/assets/".length) : null;
    // if (!filename) {
    //   throw new ShelfError({
    //     cause: null,
    //     message: "Cannot find filename",
    //     additionalData: { userId, assetId, mainImage },
    //     label: "Assets",
    //   });
    // }
    // const signedUrl = await createSignedUrl({
    //   filename,
    // });
    // const asset = await updateAsset({
    //   id: assetId,
    //   mainImage: signedUrl,
    //   mainImageExpiration: oneDayFromNow(),
    //   userId,
    // });
    return json(data({ mode }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId: authSession.userId });
    return json(error(reason), { status: reason.status });
  }
}
