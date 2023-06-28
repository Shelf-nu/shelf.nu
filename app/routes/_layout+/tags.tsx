import type { Tag } from "@prisma/client";
import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
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
import { deleteTag, getTags } from "~/modules/tag";
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

  const { tags, totalTags } = await getTags({
    userId,
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
  return json({
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

  await deleteTag({ id, userId });
  sendNotification({
    title: "Tag deleted",
    message: "Your tag has been deleted successfully",
    icon: { name: "trash", variant: "error" },
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
    <Td className="w-full text-left" title={`Tag: ${item.name}`}>
      <TagBadge>{item.name}</TagBadge>
    </Td>
    <Td className="text-left">
      <DeleteTag tag={item} />
    </Td>
  </>
);
