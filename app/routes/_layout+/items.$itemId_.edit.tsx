import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useCatch, useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/items.new";
import type { NotificationType } from "~/atoms/notifications";
import { ItemForm, NewItemFormSchema } from "~/components/items/form";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getCategories } from "~/modules/category";
import { getItem, updateItem, updateItemMainImage } from "~/modules/item";
import { assertIsPost, getRequiredParam } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const { categories } = await getCategories({
    userId,
    perPage: 100,
  });

  const id = getRequiredParam(params, "itemId");

  const item = await getItem({ userId, id });
  if (!item) {
    throw new Response("Not Found", { status: 404 });
  }

  const header: HeaderData = {
    title: `Edit | ${item.title}`,
    subHeading: item.id,
  };

  return json({
    item,
    header,
    categories,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export const handle = {
  breadcrumb: () => "Edit",
};

export async function action({ request, params }: ActionArgs) {
  assertIsPost(request);
  const id = getRequiredParam(params, "itemId");
  const clonedRequest = request.clone();
  const authSession = await requireAuthSession(request);
  const formData = await request.formData();
  const result = await NewItemFormSchema.safeParseAsync(parseFormAny(formData));
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

  updateItemMainImage({ request: clonedRequest, itemId: id });

  const { title, description, category } = result.data;

  const updatedItem = await updateItem({
    id,
    title,
    description,
    categoryId: category,
  });

  const notification: Omit<NotificationType, "open"> = {
    title: "Item updated",
    message: "Your item has been updated",
    icon: { name: "success", variant: "success" },
  };

  return json(
    { success: true, notification, updatedItem },
    {
      headers: {
        "Set-Cookie": await commitAuthSession(request, { authSession }),
      },
    }
  );
}

export default function ItemEditPage() {
  const title = useAtomValue(titleAtom);
  const hasTitle = title !== "Untitled item";
  const { item } = useLoaderData<typeof loader>();

  return (
    <>
      <Header title={hasTitle ? title : item.title} />
      <div className=" items-top flex justify-between">
        <ItemForm
          title={item.title}
          category={item.categoryId}
          description={item.description}
        />
      </div>
    </>
  );
}

export function ErrorBoundary({ error }: { error: Error }) {
  return (
    <>
      <div>An unexpected error occurred: {error.message}</div>
    </>
  );
}

export function CatchBoundary() {
  const caught = useCatch();

  if (caught.status === 404) {
    return <div>Item not found</div>;
  }

  throw new Error(`Unexpected caught response with status: ${caught.status}`);
}
