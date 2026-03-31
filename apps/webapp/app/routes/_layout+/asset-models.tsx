import type { AssetModel, Category } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, Link, Outlet } from "react-router";
import { z } from "zod";
import AssetModelQuickActions from "~/components/asset-model/asset-model-quick-actions";
import AssetModelBulkActionsDropdown from "~/components/asset-model/bulk-actions-dropdown";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import LineBreakText from "~/components/layout/line-break-text";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Th, Td } from "~/components/table";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  deleteAssetModel,
  getAssetModels,
} from "~/modules/asset-model/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  payload,
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
      entity: PermissionEntity.assetModel,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const { assetModels, totalAssetModels } = await getAssetModels({
      organizationId,
      page,
      perPage,
      search,
    });
    const totalPages = Math.ceil(totalAssetModels / perPage);

    const header: HeaderData = {
      title: "Asset Models",
    };
    const modelName = {
      singular: "asset model",
      plural: "asset models",
    };

    return data(
      payload({
        header,
        items: assetModels,
        search,
        page,
        totalItems: totalAssetModels,
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
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
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

    await deleteAssetModel({ id, organizationId });

    sendNotification({
      title: "Asset model deleted",
      message: "Your asset model has been deleted successfully",
      icon: { name: "trash", variant: "error" },
      senderId: userId,
    });

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => <Link to="/asset-models">Asset Models</Link>,
};
export const ErrorBoundary = () => <ErrorContent />;

export default function AssetModelsPage() {
  const { isBaseOrSelfService } = useUserRoleHelper();

  return (
    <>
      <Header>
        <Button
          to="new"
          role="link"
          aria-label="new asset model"
          data-test-id="createNewAssetModel"
        >
          New asset model
        </Button>
      </Header>
      <ListContentWrapper>
        <Filters />
        <Outlet />
        <List
          bulkActions={
            isBaseOrSelfService ? undefined : <AssetModelBulkActionsDropdown />
          }
          ItemComponent={AssetModelItem}
          headerChildren={
            <>
              <Th>Description</Th>
              <Th>Default category</Th>
              <Th>Assets</Th>
              <Th>Actions</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

const AssetModelItem = ({
  item,
}: {
  item: Pick<AssetModel, "id" | "description" | "name"> & {
    _count: {
      assets: number;
    };
    defaultCategory?: Pick<Category, "id" | "name" | "color"> | null;
  };
}) => (
  <>
    <Td title={`Asset model: ${item.name}`} className="w-1/4">
      {item.name}
    </Td>
    <Td className="max-w-62 md:w-2/4">
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
      {item.defaultCategory ? (
        <Badge color={item.defaultCategory.color} withDot={false}>
          {item.defaultCategory.name}
        </Badge>
      ) : (
        <span className="text-gray-400">—</span>
      )}
    </Td>
    <Td>{item._count.assets}</Td>
    <Td>
      <AssetModelQuickActions assetModel={item} />
    </Td>
  </>
);
