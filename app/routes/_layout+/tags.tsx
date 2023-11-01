import type { Tag } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { Filters, List } from "~/components/list";
import { Button } from "~/components/shared/button";
import { Tag as TagBadge } from "~/components/shared/tag";
import { Th, Td } from "~/components/table";
import { DeleteTag } from "~/components/tag/delete-tag";

import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { deleteTag, getTags } from "~/modules/tag";
import {
  assertIsDelete,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage, userPrefs } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;
  const { prev, next } = generatePageMeta(request);
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
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;

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
      <div className="mt-8 flex flex-1 flex-col gap-2">
        <Filters />
        <Outlet />
        <List
          ItemComponent={TagItem}
          headerChildren={
            <>
              <Th>Description</Th>
              <Th>Actions</Th>
            </>
          }
        />
      </div>
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
