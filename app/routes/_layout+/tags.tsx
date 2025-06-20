import type { Tag } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import LineBreakText from "~/components/layout/line-break-text";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Tag as TagBadge } from "~/components/shared/tag";
import { Th, Td } from "~/components/table";
import BulkActionsDropdown from "~/components/tag/bulk-actions-dropdown";
import { DeleteTag } from "~/components/tag/delete-tag";
import TagUseForFilter from "~/components/tag/tag-use-for-filter";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";

import { deleteTag, getTags } from "~/modules/tag/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  assertIsDelete,
  data,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
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
      request,
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
      data({
        header,
        items: tags,
        search,
        page,
        totalItems: totalTags,
        totalPages,
        perPage,
        modelName,
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsDelete(request);

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.tag,
      action: PermissionAction.delete,
    });

    const { id } = parseData(
      await request.formData(),
      z.object({
        id: z.string(),
      }),
      {
        additionalData: { userId },
      }
    );

    await deleteTag({ id, organizationId });

    sendNotification({
      title: "Tag deleted",
      message: "Your tag has been deleted successfully",
      icon: { name: "trash", variant: "error" },
      senderId: userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => <Link to="/tags">Tags</Link>,
};
export const ErrorBoundary = () => <ErrorContent />;

export default function CategoriesPage() {
  const { isBaseOrSelfService } = useUserRoleHelper();

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
        <Filters
          slots={{
            "right-of-search": <TagUseForFilter />,
          }}
        />
        <Outlet />
        <List
          bulkActions={
            isBaseOrSelfService ? undefined : <BulkActionsDropdown />
          }
          ItemComponent={TagItem}
          headerChildren={
            <>
              <Th>Description</Th>
              <Th>Use for</Th>
              <Th>Actions</Th>
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
  item: Pick<Tag, "id" | "description" | "name" | "useFor">;
}) => (
  <>
    <Td className="w-1/4 text-left" title={`Tag: ${item.name}`}>
      <TagBadge>{item.name}</TagBadge>
    </Td>
    <Td className="max-w-62 md:w-3/4">
      {item.description ? (
        <LineBreakText
          className="md:w-3/4"
          text={item.description}
          numberOfLines={3}
          charactersPerLine={60}
        />
      ) : null}
    </Td>
    <Td>
      <div className="flex items-center gap-2">
        {item.useFor && item.useFor.length > 0
          ? item.useFor.map((useFor) => (
              <GrayBadge key={useFor}>{useFor}</GrayBadge>
            ))
          : null}
      </div>
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
