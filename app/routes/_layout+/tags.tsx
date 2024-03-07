import type { Tag } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { ErrorBoundryComponent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Button } from "~/components/shared/button";
import { Tag as TagBadge } from "~/components/shared/tag";
import { Th, Td } from "~/components/table";
import { DeleteTag } from "~/components/tag/delete-tag";

import { deleteTag, getTags } from "~/modules/tag";
import {
  assertIsDelete,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage, userPrefs } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = await context.getSession();
  const { organizationId } = await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.tag,
    action: PermissionAction.read,
  });

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;
  const { tags, totalTags } = await getTags({
    organizationId,
    page,
    perPage,
    search,
  });
  const totalPages = Math.ceil(totalTags / perPage);

  const header: HeaderData = {
    title: "Tags",
  };
  const modelName = {
    singular: "tag",
    plural: "tags",
  };
  return json(
    {
      header,
      items: tags,
      search,
      page,
      totalItems: totalTags,
      totalPages,
      perPage,
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

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = await context.getSession();
  const { userId } = authSession;

  const { organizationId } = await requirePermision({
    userId,
    request,
    entity: PermissionEntity.tag,
    action: PermissionAction.delete,
  });

  assertIsDelete(request);
  const formData = await request.formData();
  const id = formData.get("id") as string;

  await deleteTag({ id, organizationId });
  sendNotification({
    title: "Tag deleted",
    message: "Your tag has been deleted successfully",
    icon: { name: "trash", variant: "error" },
    senderId: userId,
  });

  return json({ success: true });
}

export const handle = {
  breadcrumb: () => <Link to="/tags">Tags</Link>,
};
export const ErrorBoundary = () => <ErrorBoundryComponent />;

export default function CategoriesPage() {
  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label={`new tag`}
          icon="plus"
          data-test-id="createNewTag"
        >
          New tag
        </Button>
      </Header>
      <ListContentWrapper>
        <Filters />
        <Outlet />
        <List
          ItemComponent={TagItem}
          headerChildren={
            <>
              <Th className="hidden md:table-cell">Description</Th>
              <Th className="hidden md:table-cell">Actions</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

const TagItem = ({
  item,
}: {
  item: Pick<Tag, "id" | "description" | "name">;
}) => (
  <>
    <Td className="w-1/4 text-left" title={`Tag: ${item.name}`}>
      <TagBadge>{item.name}</TagBadge>
    </Td>
    <Td className="w-3/4 text-gray-500" title="Description">
      {item.description}
    </Td>
    <Td className="text-left">
      <Button
        to={`${item.id}/edit`}
        role="link"
        aria-label={`edit tags`}
        variant="secondary"
        size="sm"
        className=" mx-2 text-[12px]"
        icon={"write"}
        title={"Edit"}
        data-test-id="editTagsButton"
      />
      <DeleteTag tag={item} />
    </Td>
  </>
);
