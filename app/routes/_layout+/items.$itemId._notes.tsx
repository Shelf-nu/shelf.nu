import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { Form, useCatch, useLoaderData } from "@remix-run/react";
import { DeleteItem } from "~/components/items/delete-item";
import { ItemImage } from "~/components/items/item-image";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { MarkdownEditor, MarkdownViewer } from "~/components/markdown";
import { Button } from "~/components/shared";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  // const id = getRequiredParam(params, "itemId");

  // const item = await getItem({ userId, id });
  // if (!item) {
  //   throw new Response("Not Found", { status: 404 });
  // }
  // const markdownDescription = parseMarkdownToReact(item.description || "");

  // const header: HeaderData = {
  //   title: item.title,
  //   subHeading: item.id,
  // };

  // return json({
  //   item: {
  //     ...item,
  //     description: markdownDescription,
  //   },
  //   header,
  // });
  return null;
}

// export async function action({ request, params }: ActionArgs) {
//   assertIsDelete(request);
//   const id = getRequiredParam(params, "itemId");
//   const authSession = await requireAuthSession(request);
//   const formData = await request.formData();
//   const mainImageUrl = formData.get("mainImage") as string;

//   await deleteItem({ userId: authSession.userId, id });
//   await deleteAssets({
//     url: mainImageUrl,
//     bucketName: "items",
//   });

//   sendNotification({
//     title: "Item deleted",
//     message: "Your item has been deleted successfully",
//     icon: { name: "trash", variant: "error" },
//   });

//   return redirect(`/items`, {
//     headers: {
//       "Set-Cookie": await commitAuthSession(request, { authSession }),
//     },
//   });
// }

export default function ItemDetailsPage() {
  return (
    <>
      <Form action={"post"}>
        <MarkdownEditor
          label={"Add a note"}
          name={"note"}
          disabled={false}
          defaultValue={""}
        />
        <Button type="submit" variant="primary">
          Create note
        </Button>
      </Form>
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
