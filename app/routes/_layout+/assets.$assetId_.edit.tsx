import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/assets.new";
import { AssetForm, NewAssetFormSchema } from "~/components/assets/form";
import { ErrorBoundryComponent } from "~/components/errors";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { getAsset, updateAsset, updateAssetMainImage } from "~/modules/asset";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getCategories } from "~/modules/category";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const { categories } = await getCategories({
    userId,
    perPage: 100,
  });

  const id = getRequiredParam(params, "assetId");

  const asset = await getAsset({ userId, id });
  if (!asset) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${asset.title}`,
    subHeading: asset.id,
  };

  return json({
    asset,
    header,
    categories,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ request, params }: ActionArgs) {
  assertIsPost(request);
  const authSession = await requireAuthSession(request);

  const id = getRequiredParam(params, "assetId");
  const clonedRequest = request.clone();
  const formData = await clonedRequest.formData();
  const result = await NewAssetFormSchema.safeParseAsync(
    parseFormAny(formData)
  );
  if (!result.success) {
    return json(
      {
        errors: result.error,
        success: false,
      },
      {
        status: 400,
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }

  updateAssetMainImage({
    request,
    assetId: id,
    userId: authSession.userId,
  });

  const { title, description, category } = result.data;

  await updateAsset({
    id,
    title,
    description,
    categoryId: category,
  });

  sendNotification({
    title: "Asset updated",
    message: "Your asset has been updated successfully",
    icon: { name: "success", variant: "success" },
  });

  return json(
    { success: true },
    {
      headers: {
        "Set-Cookie": await commitAuthSession(request, { authSession }),
      },
    }
  );
}

export default function AssetEditPage() {
  const title = useAtomValue(titleAtom);
  const hasTitle = title !== "Untitled asset";
  const { asset } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasTitle ? title : asset.title} />
      <div className=" items-top flex justify-between">
        <AssetForm
          title={asset.title}
          category={asset.categoryId}
          description={asset.description}
        />
      </div>
    </>
  );
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
