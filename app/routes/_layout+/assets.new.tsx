import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useSearchParams } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/assets.new";

import { AssetForm, NewAssetFormSchema } from "~/components/assets/form";
import Header from "~/components/layout/header";

import { createAsset, updateAssetMainImage } from "~/modules/asset";
import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getCategories } from "~/modules/category";
import { getTags } from "~/modules/tag";
import { assertIsPost } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

const title = "New Asset";

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const { categories } = await getCategories({
    userId,
    perPage: 100,
  });
  const { tags } = await getTags({
    userId,
    perPage: 100,
  });

  const header = {
    title,
  };

  return json({ header, categories, tags });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ request }: LoaderArgs) {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);

  /** Here we need to clone the request as we need 2 different streams:
   * 1. Access form data for creating asset
   * 2. Access form data via upload handler to be able to upload the file
   *
   * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
   */
  const clonedRequest = request.clone();

  const formData = await clonedRequest.formData();
  const result = await NewAssetFormSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  const { title, description, category, qrId } = result.data;

  const asset = await createAsset({
    title,
    description,
    userId: authSession.userId,
    categoryId: category,
    qrId,
  });

  // Not sure how to handle this failign as the asset is already created
  await updateAssetMainImage({
    request,
    assetId: asset.id,
    userId: authSession.userId,
  });

  sendNotification({
    title: "Asset created",
    message: "Your asset has been created successfully",
    icon: { name: "success", variant: "success" },
  });

  return redirect(`/assets/${asset.id}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewAssetPage() {
  const title = useAtomValue(titleAtom);
  const [searchParams] = useSearchParams();
  const qrId = searchParams.get("qrId");

  return (
    <>
      <Header title={title} />
      <div>
        <AssetForm qrId={qrId} />
      </div>
    </>
  );
}
