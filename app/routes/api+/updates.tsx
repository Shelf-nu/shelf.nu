import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getUpdatesForUser,
  markUpdateAsRead,
  markAllUpdatesAsRead,
  trackUpdateClick,
  trackUpdateView,
} from "~/modules/update/service.server";
import { makeShelfError } from "~/utils/error";
import { payload } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.update,
      action: PermissionAction.read,
    });

    // Get updates for the user with their organization role
    const updates = await getUpdatesForUser({
      userId,
      userRole: role,
    });

    return payload({
      updates: updates.map((update) => ({
        ...update,
        content: parseMarkdownToReact(update.content),
      })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(reason, { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { role } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.update,
      action: PermissionAction.read,
    });

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    switch (intent) {
      case "markAsRead": {
        const updateId = formData.get("updateId") as string;
        if (!updateId) {
          throw new Error("Update ID is required");
        }
        await markUpdateAsRead({ updateId, userId });
        return payload({ success: true });
      }

      case "markAllAsRead": {
        await markAllUpdatesAsRead({ userId, userRole: role });
        return payload({ success: true });
      }

      case "trackClick": {
        const updateId = formData.get("updateId") as string;
        if (!updateId) {
          throw new Error("Update ID is required");
        }
        await trackUpdateClick({ updateId });
        return payload({ success: true });
      }

      case "clickUpdate": {
        const updateId = formData.get("updateId") as string;
        if (!updateId) {
          throw new Error("Update ID is required");
        }
        // Mark as read (creates read record, increments view count) AND track click (increments click count)
        await markUpdateAsRead({ updateId, userId });
        await trackUpdateClick({ updateId });
        return payload({ success: true });
      }

      case "trackViews": {
        const updateIds = (formData.get("updateIds") as string)
          ?.split(",")
          .filter(Boolean);
        if (!updateIds || updateIds.length === 0) {
          throw new Error("Update IDs are required");
        }
        // Only increment view count for updates (when popover opens)
        await Promise.all(
          updateIds.map((updateId) => trackUpdateView({ updateId }))
        );
        return payload({ success: true });
      }

      default:
        throw new Error(`Unknown intent: ${intent}`);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(reason, { status: reason.status });
  }
}
