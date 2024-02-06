import type { Category } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { DeleteCategory } from "~/components/category/delete-category";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Th, Td } from "~/components/table";
import { deleteCategory, getCategories } from "~/modules/category";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage, userPrefs } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { organizationId } = await requirePermision(
    request,
    PermissionEntity.category,
    PermissionAction.read
  );

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;
  const { prev, next } = generatePageMeta(request);

  const { categories, totalCategories } = await getCategories({
    organizationId,
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

  return json(
    {
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
    },
    {
      headers: {
        "Set-Cookie": await userPrefs.serialize(cookie),
      },
    }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ request }: ActionFunctionArgs) {
  const { authSession, organizationId } = await requirePermision(
    request,
    PermissionEntity.category,
    PermissionAction.delete
  );
  const { userId } = authSession;

  const formData = await request.formData();
  const id = formData.get("id") as string;

  await deleteCategory({ id, organizationId });
  sendNotification({
    title: "Category deleted",
    message: "Your category has been deleted successfully",
    icon: { name: "trash", variant: "error" },
    senderId: userId,
  });

  return json({ success: true });
}

export const handle = {
  breadcrumb: () => <Link to="/categories">Categories</Link>,
};
export const ErrorBoundary = () => <ErrorContent />;

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
      <ListContentWrapper>
        <Filters />
        <Outlet />
        <List
          ItemComponent={CategoryItem}
          headerChildren={
            <>
              <Th className="hidden md:table-cell">Description</Th>
              <Th className="hidden md:table-cell">Assets</Th>
              <Th className="hidden md:table-cell">Actions</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

const CategoryItem = ({
  item,
}: {
  item: Pick<Category, "id" | "description" | "name" | "color"> & {
    _count: {
      assets: number;
    };
  };
}) => (
  <>
    <Td title={`Category: ${item.name}`} className="w-1/4 ">
      <Badge color={item.color} withDot={false}>
        {item.name}
      </Badge>
    </Td>
    <Td className="w-3/4 text-gray-500" title="Description">
      {item.description}
    </Td>
    <Td>{item._count.assets}</Td>
    <Td>
      <Button
        to={`${item.id}/edit`}
        role="link"
        aria-label={`edit category`}
        variant="secondary"
        size="sm"
        className=" mx-2 text-[12px]"
        icon={"write"}
        title={"Edit"}
        data-test-id="editCategoryButton"
      />
      <DeleteCategory category={item} />
    </Td>
  </>
);
