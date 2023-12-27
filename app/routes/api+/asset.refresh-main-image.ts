import { json, type ActionFunctionArgs } from "@remix-run/node";
import { updateAsset } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { assertIsPost, oneDayFromNow } from "~/utils";
import { createSignedUrl } from "~/utils/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  assertIsPost(request);
  const { userId } = await requireAuthSession(request);
  const formData = await request.formData();
  const assetId = formData.get("assetId") as string;
  const mainImage = formData.get("mainImage") as string;
  if (!assetId || !mainImage)
    return json({ error: "Asset id & mainImage are reqired", asset: null });

  const regex =
    // eslint-disable-next-line no-useless-escape
    /\/assets\/([a-f0-9-]+)\/([a-z0-9]+)\/([a-z0-9\-]+\.[a-z]{3,4})/i;
  const match = mainImage.match(regex);

  const filename = match ? `/${match[1]}/${match[2]}/${match[3]}` : null;

  if (!filename) return json({ error: "Cannot find filename", asset: null });

  const signedUrl = await createSignedUrl({
    filename,
  });
  if (typeof signedUrl !== "string")
    return json({ error: signedUrl, asset: null });

  const rsp = await updateAsset({
    id: assetId,
    mainImage: signedUrl,
    mainImageExpiration: oneDayFromNow(),
    userId,
  });
  // @ts-ignore
  // @TODO fix this. MIght need to modify how handling the error works
  const { asset } = rsp;
  return json({ asset, error: "" });
};
