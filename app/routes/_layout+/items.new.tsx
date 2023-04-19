import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useAtomValue } from "jotai";
import { parseFormAny } from "react-zorm";
import { titleAtom } from "~/atoms/items.new";

import { ItemForm, NewItemFormSchema } from "~/components/items/form";
import Header from "~/components/layout/header";

import { requireAuthSession, commitAuthSession } from "~/modules/auth";
import { getCategories } from "~/modules/category";
import { createItem, updateItemMainImage } from "~/modules/item";
import { assertIsPost } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

const title = "New Item";

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const { categories } = await getCategories({
    userId,
    perPage: 100,
  });

  const header = {
    title,
  };

  return json({ header, categories });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.header.title) },
];

export const handle = {
  breadcrumb: () => <span>{title}</span>,
};

export async function action({ request }: LoaderArgs) {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);

  /** Here we need to clone the request as we need 2 different streams:
   * 1. Access form data for creating item
   * 2. Access form data via upload handler to be able to upload the file
   *
   * This solution is based on : https://github.com/remix-run/remix/issues/3971#issuecomment-1222127635
   */
  const clonedRequest = request.clone();

  const formData = await clonedRequest.formData();
  const result = await NewItemFormSchema.safeParseAsync(parseFormAny(formData));

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

  const { title, description, category } = result.data;

  const item = await createItem({
    title,
    description,
    userId: authSession.userId,
    categoryId: category,
  });

  // Not sure how to handle this failign as the item is already created
  await updateItemMainImage({ request, itemId: item.id });

  const notification = new URLSearchParams({
    notificationTitle: "Item created.",
    notificationMessage: "Your item has been created successfully",
    notificationIcon: "success",
    notificationVariant: "success",
  });
  return redirect(`/items/${item.id}?${notification}`, {
    headers: {
      "Set-Cookie": await commitAuthSession(request, { authSession }),
    },
  });
}

export default function NewItemPage() {
  const title = useAtomValue(titleAtom);

  return (
    <>
      <Header title={title} />
      <div>
        <ItemForm />
      </div>
    </>
  );
}
