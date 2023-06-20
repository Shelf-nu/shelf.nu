import type { V2_MetaFunction } from "@remix-run/node";
import { json, type LoaderArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { requireAuthSession } from "~/modules/auth";
import { getLocation } from "~/modules/location";
import { getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  const id = getRequiredParam(params, "assetId");

  const location = await getLocation({ userId, id });
  if (!location) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${location.name}`,
  };

  return json({
    location,
    header,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export default function AssetEditPage() {
  // const title = useAtomValue(titleAtom);
  // const hasTitle = title !== "Untitled asset";
  const { location } = useLoaderData<typeof loader>();

  return (
    <>
      {/* <Header title={hasTitle ? title : asset.title} /> */}
      <div className=" items-top flex justify-between">
        {/* <AssetForm
          title={asset.title}
          category={asset.categoryId}
          description={asset.description}
          tags={tags}
        /> */}
      </div>
    </>
  );
}

export const ErrorBoundary = () => <ErrorBoundryComponent />;
