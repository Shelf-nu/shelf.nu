import type { Category } from "@prisma/client";
import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { DeleteCategory } from "~/components/category/delete-category";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";

import { requireAuthSession } from "~/modules/auth";
import { deleteCategory, getCategories } from "~/modules/category";
import {
  assertIsDelete,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);

  const searchParams = getCurrentSearchParams(request);
  const { page, perPage, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const { categories, totalCategories } = await getCategories({
    userId,
    page,
    perPage,
    search,
  });
  const totalPages = Math.ceil(totalCategories / perPage);

  const header: HeaderData = {
    title: "Categories",
  };
  const modelName = {
    singular: "category",
    plural: "categories",
  };
  return json({
    header,
    items: categories,
    search,
    page,
    totalItems: totalCategories,
    totalPages,
    perPage,
    prev,
    next,
    modelName,
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ request }: ActionArgs) {
  const { userId } = await requireAuthSession(request);
  assertIsDelete(request);
  const formData = await request.formData();
  const id = formData.get("id") as string;

  await deleteCategory({ id, userId });
  sendNotification({
    title: "Category deleted",
    message: "Your category has been deleted successfully",
    icon: { name: "trash", variant: "error" },
  });

  return json({ success: true });
}

export const handle = {
  breadcrumb: () => <Link to="/categories">Categories</Link>,
};

export default function CategoriesPage() {
  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new category`}
          icon="plus"
          data-test-id="createNewCategory"
        >
          New Category
        </Button>
      </Header>
      <div className="mt-8 flex flex-1 flex-col gap-2">
        <Filters />
        <Outlet />
        <List
          ItemComponent={CategoryItem}
          headerChildren={
            <>
              <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                Description
              </th>
              <th className="hidden border-b p-4 text-left font-normal text-gray-600 md:table-cell md:px-6">
                Actions
              </th>
            </>
          }
        />
      </div>
    </>
  );
}

const CategoryItem = ({
  item,
}: {
  item: Pick<Category, "id" | "description" | "name" | "color">;
}) => (
  <>
    <td title={`Category: ${item.name}`} className="w-1/4 border-b p-4 md:px-6">
      <Badge color={item.color}>{item.name}</Badge>
    </td>
    <td
      className="w-3/4 border-b p-4 text-gray-500 md:px-6"
      title="Description"
    >
      {item.description}
    </td>
    <td className="whitespace-nowrap border-b p-4 md:px-6">
      <DeleteCategory category={item} />
    </td>
  </>
);
