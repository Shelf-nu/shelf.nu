/**
 * Route: Asset Models (parent layout)
 *
 * Parent layout for the asset models settings section.
 * Renders an Outlet for child routes (index, new, edit).
 * Handles the delete action for asset models.
 *
 * @see {@link file://./settings.asset-models.index.tsx} Index route
 * @see {@link file://./settings.asset-models.new.tsx} Create route
 * @see {@link file://./settings.asset-models.$assetModelId_.edit.tsx} Edit route
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, Outlet } from "react-router";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import { deleteAssetModel } from "~/modules/asset-model/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta = () => [
  { title: appendToMetaTitle("Asset models settings") },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.read,
    });

    return payload(null);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

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
  breadcrumb: () => <Link to="/settings/asset-models">Asset Models</Link>,
};

export default function AssetModelsLayout() {
  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
