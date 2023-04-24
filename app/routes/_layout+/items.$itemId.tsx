import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useCatch, useLoaderData } from "@remix-run/react";
import { DeleteItem } from "~/components/items/delete-item";
import { ItemImage } from "~/components/items/item-image";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { MarkdownViewer, MarkdownEditor } from "~/components/markdown";

import { Badge } from "~/components/shared";
import { Button } from "~/components/shared/button";
import ProfilePicture from "~/components/user/profile-picture";
import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { deleteItem, getItem } from "~/modules/item";
import { assertIsDelete, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
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

  sendNotification({
    title: "Item deleted",
    message: "Your item has been deleted successfully",
    icon: { name: "trash", variant: "error" },
  });

  return redirect(`/items`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function ItemDetailsPage() {
  const { item } = useLoaderData<typeof loader>();

  return (
    <>
      <Header>
        <Button icon="barcode" variant="secondary">
          Download QR Tag
        </Button>
        <Button to="edit" icon="pen" role="link">
          Edit
        </Button>
        <DeleteItem item={item} />
      </Header>
      <div className="mt-8 flex">
        <div className="w-[400px]">
          <ItemImage
            item={{
              itemId: item.id,
              mainImage: item.mainImage,
              // @ts-ignore
              mainImageExpiration: item.mainImageExpiration,
              alt: item.title,
            }}
            className="mb-8 h-[400px] w-full"
          />
          <MarkdownViewer content={item.description} className="mb-8" />
          <ul className="item-information mb-8">
            <li className="mb-4 flex justify-between">
              <span className="text-[14px] font-medium text-gray-600">
                Category
              </span>
              <div className="max-w-[250px]">
                <Badge color="#5925DC"> Laptops </Badge>
              </div>
            </li>
            <li className="mb-4 flex justify-between">
              <span className="text-[14px] font-medium text-gray-600">
                Tags
              </span>
              <div className="flex max-w-[250px] flex-wrap items-center justify-end">
                <span className="mb-1 ml-1 rounded-2xl bg-gray-100 px-2 py-0.5 text-[12px] font-medium text-gray-700">
                  High Impact
                </span>
                <span className="mb-1 ml-1 rounded-2xl bg-gray-100 px-2 py-0.5 text-[12px] font-medium text-gray-700">
                  2021
                </span>
                <span className="mb-1 ml-1 rounded-2xl bg-gray-100 px-2 py-0.5 text-[12px] font-medium text-gray-700">
                  Serial number: C02XKPQEJHC8
                </span>
                <span className="mb-1 ml-1 rounded-2xl bg-gray-100 px-2 py-0.5 text-[12px] font-medium text-gray-700">
                  OK Condition
                </span>
              </div>
            </li>
            <li className="mb-4 flex justify-between">
              <span className="text-[14px] font-medium text-gray-600">
                Owner
              </span>
              <div className="max-w-[250px]">
                <span className="mb-1 ml-1 inline-flex items-center rounded-2xl bg-gray-100 px-2 py-0.5">
                  <ProfilePicture width="w-4" height="h-4" />
                  <span className="ml-1.5 text-[12px] font-medium text-gray-700">
                    Sandra Perimirelli
                  </span>
                </span>
              </div>
            </li>
          </ul>
          <figure className="item-location">
            <img src="/images/map-placeholder.jpg" alt="map" />
          </figure>
        </div>
        <div className="ml-8 w-2/3">
          <ul className="comments-list w-full">
            <li className="comment mb-8 rounded-lg border">
              <header className="border-b px-3.5 py-3">
                <span className="commentator  font-medium text-gray-900">
                  Carlos Virreria
                </span>{" "}
                <span className="text-gray-600">commented 2 weeks ago</span>
              </header>
              <div className="message px-3.5 py-3">
                <p>Bing bong, testing.</p>
              </div>
            </li>
            <li className="comment mb-8 rounded-lg border">
              <header className="border-b px-3.5 py-3">
                <span className="commentator  font-medium text-gray-900">
                  Nikolay Bonev
                </span>{" "}
                <span className="text-gray-600">commented 1 week ago</span>
              </header>
              <div className="message px-3.5 py-3">
                <p>Best performance experienced from this device</p>
              </div>
            </li>
            <li className="comment mb-8 rounded-lg border">
              <header className="border-b px-3.5 py-3">
                <span className="commentator  font-medium text-gray-900">
                  Nikolay Bonev
                </span>{" "}
                <span className="text-gray-600">commented 1 week ago</span>
              </header>
              <div className="message px-3.5 py-3">
                <p>
                  Lorem ipsum dolor sit amet consectetur adipisicing elit. Harum
                  sapiente inventore est hic illo voluptates eveniet natus
                  commodi voluptatum laboriosam minus sunt aperiam dicta
                  accusamus quaerat, rem quod minima. Quasi consequatur ex
                  dolores deleniti similique dolorum consectetur adipisci
                  debitis earum nisi enim voluptate eum ducimus possimus fugiat,
                  repellat at eius.
                </p>
              </div>
            </li>
            <li className="comment mb-8 rounded-lg border">
              <header className="border-b px-3.5 py-3">
                <span className="commentator  font-medium text-gray-900">
                  Hunar Arora
                </span>{" "}
                <span className="text-gray-600">commented 1 week ago</span>
              </header>
              <div className="message px-3.5 py-3">
                <p>It's in the best condition available</p>
              </div>
            </li>
          </ul>
          <div>
            <MarkdownEditor
              label="comment"
              name="comment"
              disabled={false}
              defaultValue=""
              placeholder="Leave a comment"
            />
          </div>
        </div>
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
