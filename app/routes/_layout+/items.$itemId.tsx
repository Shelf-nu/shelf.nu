import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { Form, useCatch, useLoaderData } from "@remix-run/react";
import { DeleteItem } from "~/components/items/delete-item";
import { ItemImage } from "~/components/items/item-image";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { MarkdownViewer } from "~/components/markdown";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { deleteItem, getItem } from "~/modules/item";
import { assertIsDelete, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { parseMarkdownToReact } from "~/utils/md.server";
import { deleteAssets } from "~/utils/storage.server";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  const id = getRequiredParam(params, "itemId");

  const item = await getItem({ userId, id });
  if (!item) {
    throw new Response("Not Found", { status: 404 });
  }
  const markdownDescription = parseMarkdownToReact(item.description || "");

  const header: HeaderData = {
    title: item.title,
    subHeading: item.id,
  };

  return json({
    item: {
      ...item,
      description: markdownDescription,
    },
    header,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export const handle = {
  breadcrumb: () => "single",
};

export async function action({ request, params }: ActionArgs) {
  assertIsDelete(request);
  const id = getRequiredParam(params, "itemId");
  const authSession = await requireAuthSession(request);
  const formData = await request.formData();
  const mainImageUrl = formData.get("mainImage") as string;

  await deleteItem({ userId: authSession.userId, id });
  await deleteAssets({
    url: mainImageUrl,
    bucketName: "items",
  });

  return redirect("/items", {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function ItemDetailsPage() {
  const { item } = useLoaderData<typeof loader>();

  return (
    <>
      <Header />
      <div className=" items-top flex justify-between">
        <ItemImage
          item={{
            itemId: item.id,
            mainImage: item.mainImage,
            // @ts-ignore
            mainImageExpiration: item.mainImageExpiration,
            alt: item.title,
          }}
          className=" h-[400px]"
        />
        <MarkdownViewer content={item.description} />
        <DeleteItem item={item} />
      </div>
    </>
  );
}

export function ErrorBoundary({ error }: { error: Error }) {
  return <div>An unexpected error occurred: {error.message}</div>;
}

export function CatchBoundary() {
  const caught = useCatch();

  if (caught.status === 404) {
    return <div>Item not found</div>;
  }

  throw new Error(`Unexpected caught response with status: ${caught.status}`);
}
